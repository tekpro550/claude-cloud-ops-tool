import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { ReportDefinitionsService } from '../report-definitions.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Report builder verification FAILED: ${message}`);
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
  const slug = `report-builder-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Report Builder Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'RB Contact', 'rb@example.com'],
  );

  const DAY = 24 * 60 * 60 * 1000;
  const MIN = 60 * 1000;
  const at = (offsetMs: number) =>
    new Date(Date.now() + offsetMs).toISOString();
  let nextNumber = 1;
  const mkTicket = async (opts: {
    status: string;
    priority: string;
    created: string;
    resolvedAt: string | null;
  }) => {
    const {
      rows: [t],
    } = await migrator.query(
      `INSERT INTO tickets
         (tenant_id, ticket_number, subject, contact_id, status, priority, source, resolved_at, created_at, updated_at)
       VALUES ($1, $7, 'RB', $2, $3, $4, 'web_form', $5, $6, $6) RETURNING id`,
      [
        tenant.id,
        contact.id,
        opts.status,
        opts.priority,
        opts.resolvedAt,
        opts.created,
        nextNumber++,
      ],
    );
    return t.id as string;
  };

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const definitions = app.get(ReportDefinitionsService);

  try {
    // ticket_count by status: 3 open, 2 resolved.
    await mkTicket({
      status: 'open',
      priority: 'high',
      created: at(-DAY),
      resolvedAt: null,
    });
    await mkTicket({
      status: 'open',
      priority: 'low',
      created: at(-DAY),
      resolvedAt: null,
    });
    await mkTicket({
      status: 'open',
      priority: 'high',
      created: at(-DAY),
      resolvedAt: null,
    });
    // Resolved in the same month: one 60 minutes, one 180 minutes -> avg 120.
    const resolvedCreated = at(-40 * DAY);
    await mkTicket({
      status: 'resolved',
      priority: 'high',
      created: resolvedCreated,
      resolvedAt: new Date(
        new Date(resolvedCreated).getTime() + 60 * MIN,
      ).toISOString(),
    });
    await mkTicket({
      status: 'resolved',
      priority: 'medium',
      created: resolvedCreated,
      resolvedAt: new Date(
        new Date(resolvedCreated).getTime() + 180 * MIN,
      ).toISOString(),
    });

    // 1. ticket_count grouped by status matches hand-counted rows.
    const byStatus = await definitions.preview(tenant.id, {
      metric: 'ticket_count',
      groupBy: 'status',
    });
    const openRow = byStatus.find(
      (r: { bucket: string }) => r.bucket === 'open',
    );
    const resolvedRow = byStatus.find(
      (r: { bucket: string }) => r.bucket === 'resolved',
    );
    assert(
      Number(openRow?.value) === 3,
      'ticket_count by status: 3 open tickets',
    );
    assert(
      Number(resolvedRow?.value) === 2,
      'ticket_count by status: 2 resolved tickets',
    );

    // 2. avg_resolution_minutes grouped by month bucketises correctly.
    const byMonth = await definitions.preview(tenant.id, {
      metric: 'avg_resolution_minutes',
      groupBy: 'month',
      filters: [{ field: 'status', value: 'resolved' }],
    });
    const monthBucket = new Date(resolvedCreated).toISOString().slice(0, 7);
    const monthRow = byMonth.find(
      (r: { bucket: string }) => r.bucket === monthBucket,
    );
    assert(
      !!monthRow && Math.abs(Number(monthRow.value) - 120) < 0.01,
      'avg_resolution_minutes by month: (60 + 180) / 2 = 120',
    );

    // 3. A filter narrows results.
    const highOnly = await definitions.preview(tenant.id, {
      metric: 'ticket_count',
      groupBy: 'status',
      filters: [{ field: 'priority', value: 'high' }],
    });
    const highOpenRow = highOnly.find(
      (r: { bucket: string }) => r.bucket === 'open',
    );
    assert(
      Number(highOpenRow?.value) === 2,
      'priority=high filter narrows open ticket_count from 3 to 2',
    );

    // 4. Out-of-allowlist metric/dimension is rejected (security-critical).
    let rejectedMetric = false;
    try {
      await definitions.preview(tenant.id, {
        metric: 'ticket_count; DROP TABLE tickets;--' as never,
        groupBy: 'status',
      });
    } catch {
      rejectedMetric = true;
    }
    assert(rejectedMetric, 'out-of-allowlist metric token is rejected');

    let rejectedDimension = false;
    try {
      await definitions.preview(tenant.id, {
        metric: 'ticket_count',
        groupBy: 'status; DROP TABLE tickets;--' as never,
      });
    } catch {
      rejectedDimension = true;
    }
    assert(
      rejectedDimension,
      'out-of-allowlist groupBy dimension token is rejected',
    );

    let rejectedFilterField = false;
    try {
      await definitions.preview(tenant.id, {
        metric: 'ticket_count',
        groupBy: 'status',
        filters: [{ field: 'not_a_real_field' as never, value: 'x' }],
      });
    } catch {
      rejectedFilterField = true;
    }
    assert(
      rejectedFilterField,
      'out-of-allowlist filter field token is rejected',
    );

    // The tickets table still exists -- the injection attempts above didn't run.
    const { rows: stillThere } = await migrator.query(
      `SELECT count(*)::int AS n FROM tickets WHERE tenant_id = $1`,
      [tenant.id],
    );
    assert(
      stillThere[0].n === 5,
      'tickets table intact after rejected injection attempts',
    );

    // 5. A saved definition re-runs identically to preview().
    const saved = await definitions.create(tenant.id, {
      name: 'Open tickets by status',
      config: { metric: 'ticket_count', groupBy: 'status' },
    });
    const { definition, rows: ranRows } = await definitions.run(
      tenant.id,
      saved.id,
    );
    assert(
      definition.id === saved.id,
      'run() loads the saved definition by id',
    );
    assert(
      JSON.stringify(ranRows) === JSON.stringify(byStatus),
      'saved definition re-run produces the same rows as the original preview',
    );

    const list = await definitions.list(tenant.id);
    assert(
      list.some((d: { id: string }) => d.id === saved.id),
      'saved definition appears in list()',
    );

    await definitions.remove(tenant.id, saved.id);
    const listAfterRemove = await definitions.list(tenant.id);
    assert(
      !listAfterRemove.some((d: { id: string }) => d.id === saved.id),
      'removed definition no longer appears in list()',
    );

    console.log('\nAll report builder checks passed.');
  } finally {
    await migrator.query(
      `DELETE FROM report_definitions WHERE tenant_id = $1`,
      [tenant.id],
    );
    await migrator.query(`DELETE FROM tickets WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(
      `DELETE FROM ticket_number_counters WHERE tenant_id = $1`,
      [tenant.id],
    );
    await migrator.query(`DELETE FROM contacts WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
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
