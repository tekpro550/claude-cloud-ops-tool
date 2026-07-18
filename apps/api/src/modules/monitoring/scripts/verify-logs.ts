// Must be set before AppModule/ConfigModule are created -- @nestjs/config
// snapshots process.env at module init, same reason verify-alerting.ts and
// verify-synthetic.ts set these before importing AppModule. The log alert
// sweep opens a ticket via the same internal HTTP contract those two hit.
const TEST_PORT = 32800 + Math.floor(Math.random() * 500);
process.env.PORT = String(TEST_PORT);
process.env.INTERNAL_API_BASE_URL = `http://localhost:${TEST_PORT}/api/v1`;

import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { LogAlertSweepService } from '../logs/log-alert-sweep.service';
import { LogsService } from '../logs/logs.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Log management verification FAILED: ${message}`);
  }
  console.log(`  OK  ${message}`);
}

function migratorClient() {
  return new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? 'cloud_ops_tool',
    user: process.env.DB_MIGRATOR_USER ?? 'postgres',
    password: process.env.DB_MIGRATOR_PASSWORD ?? 'postgres',
  });
}

async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `logs-verify-${Date.now()}`;
  const {
    rows: [tenantA],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Logs Verify A', slug],
  );
  const {
    rows: [tenantB],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Logs Verify B', `${slug}-b`],
  );

  const app: INestApplication = await NestFactory.create(AppModule, {
    logger: false,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(TEST_PORT);
  const baseUrl = `http://localhost:${TEST_PORT}/api/v1`;

  const logs = app.get(LogsService);
  const sweep = app.get(LogAlertSweepService);

  try {
    // --- Create a source (tenant A) and a decoy source (tenant B) ---
    const source = await logs.createSource(tenantA.id, { name: 'api-prod' });
    assert(!!source.token, 'createSource() returns a signed ingest token');
    const decoySource = await logs.createSource(tenantB.id, {
      name: 'other-tenant-source',
    });

    // --- The ingest token maps to exactly one source/tenant ---
    const ingest = (token: string, entries: unknown[]) =>
      fetch(`${baseUrl}/logs/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ entries }),
      });

    const noAuthRes = await fetch(`${baseUrl}/logs/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: [{ message: 'no token' }] }),
    });
    assert(noAuthRes.status === 401, 'ingest without a token is rejected');

    const disabled = await logs.updateSource(tenantB.id, decoySource.id, {
      isActive: false,
    });
    assert(disabled.is_active === false, 'a source can be disabled');
    const disabledRes = await ingest(decoySource.token, [
      { message: 'should be rejected' },
    ]);
    assert(disabledRes.status === 401, "a disabled source's token is rejected");

    // --- Ingest a batch spanning levels, messages, and an explicit timestamp ---
    const now = Date.now();
    const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();
    const ingestRes = await ingest(source.token, [
      { level: 'info', message: 'request completed in 12ms', ts: at(-60_000) },
      { level: 'warn', message: 'slow query took 900ms', ts: at(-50_000) },
      {
        level: 'error',
        message: 'OutOfMemoryError: heap space exhausted',
        ts: at(-40_000),
      },
      { level: 'error', message: 'connection reset by peer', ts: at(-30_000) },
      {
        level: 'warn',
        message: 'OutOfMemoryError warning threshold approaching',
        ts: at(-20_000),
      },
    ]);
    assert(ingestRes.status === 204, 'a batch of entries is accepted (204)');

    // --- Full-text search matches by keyword ---
    const oomResults = await logs.search(tenantA.id, {
      sourceId: source.id,
      q: 'OutOfMemoryError',
    });
    assert(
      oomResults.length === 2 &&
        oomResults.every((r: { message: string }) =>
          r.message.includes('OutOfMemoryError'),
        ),
      'full-text search for "OutOfMemoryError" matches exactly the 2 entries containing it',
    );
    const resetResults = await logs.search(tenantA.id, {
      sourceId: source.id,
      q: 'connection reset',
    });
    assert(
      resetResults.length === 1,
      'full-text search for "connection reset" matches exactly 1 entry',
    );

    // --- Filters by level and time ---
    const errorLevel = await logs.search(tenantA.id, {
      sourceId: source.id,
      level: 'error',
    });
    assert(
      errorLevel.length === 2,
      'level=error filter matches exactly the 2 error-level entries',
    );

    const windowed = await logs.search(tenantA.id, {
      sourceId: source.id,
      from: at(-45_000),
      to: at(-25_000),
    });
    assert(
      windowed.length === 2,
      'a from/to time-range filter matches exactly the entries in that window',
    );

    // --- RLS hides tenant A's logs from tenant B ---
    const crossTenant = await logs.search(tenantB.id, { sourceId: source.id });
    assert(
      crossTenant.length === 0,
      "RLS: tenant B's search for tenant A's source_id returns nothing",
    );
    const tenantBSources = await logs.listSources(tenantB.id);
    assert(
      !tenantBSources.some((s: { id: string }) => s.id === source.id),
      "RLS: tenant B's source list never includes tenant A's source",
    );

    // --- A log-alert rule does not fire below threshold ---
    const rule = await logs.createAlertRule(tenantA.id, {
      logSourceId: source.id,
      name: 'Too many errors',
      levelAtLeast: 'error',
      windowSeconds: 600,
      threshold: 3,
    });
    const belowThresholdFired = await sweep.runSweepOnce();
    assert(
      belowThresholdFired === 0,
      'the rule does not fire with only 2 matching (level >= error) entries against a threshold of 3',
    );
    const { rows: rulesAfterFirstSweep } = await migrator.query(
      `SELECT last_fired_at FROM log_alert_rules WHERE id = $1`,
      [rule.id],
    );
    assert(
      rulesAfterFirstSweep[0].last_fired_at === null,
      'the rule has not fired yet (2 error entries so far, threshold is 3)',
    );

    // --- Crossing the threshold fires the rule and opens a ticket ---
    await ingest(source.token, [
      { level: 'error', message: 'disk write failed', ts: at(-5_000) },
    ]);
    const firedCount = await sweep.runSweepOnce();
    assert(
      firedCount === 1,
      'the rule fires once the 3rd error entry crosses the threshold',
    );

    const { rows: rulesAfterFire } = await migrator.query(
      `SELECT last_fired_at FROM log_alert_rules WHERE id = $1`,
      [rule.id],
    );
    assert(
      rulesAfterFire[0].last_fired_at !== null,
      'last_fired_at is set once the rule fires',
    );

    const { rows: openedTickets } = await migrator.query(
      `SELECT * FROM tickets WHERE tenant_id = $1 AND subject LIKE $2`,
      [tenantA.id, '[Logs] Too many errors:%'],
    );
    assert(
      openedTickets.length === 1,
      'exactly one ticket was opened via the internal contract for the breach',
    );
    assert(
      openedTickets[0].priority === 'high',
      "the ticket priority reflects the rule's level_at_least (error -> high)",
    );

    // --- Debounced: an immediate re-sweep does not fire again ---
    const immediateRefire = await sweep.runSweepOnce();
    assert(
      immediateRefire === 0,
      'the rule does not re-fire on the very next sweep (debounced by window_seconds)',
    );

    console.log('\nAll log management checks passed.');
  } finally {
    // A fired rule opens a ticket, so cleanup can't delete sources before
    // tickets exist -- cascade the whole tenant, same as verify-synthetic.ts.
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenantA.id]);
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenantB.id]);
    await migrator.end();
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
