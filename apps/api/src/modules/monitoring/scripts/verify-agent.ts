const TEST_PORT = 32700 + Math.floor(Math.random() * 500);
process.env.PORT = String(TEST_PORT);
process.env.INTERNAL_API_BASE_URL = `http://localhost:${TEST_PORT}/api/v1`;

import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { AgentTokensService } from '../agent-tokens.service';
import { AlertRulesService } from '../alert-rules.service';
import { MonitorsService } from '../monitors.service';
import { MonitorSchedulerService } from '../monitor-scheduler.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Agent verification FAILED: ${message}`);
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

  const slug = `agent-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Agent Verify', slug],
  );
  const {
    rows: [resource],
  } = await migrator.query(
    `INSERT INTO resources (tenant_id, name, resource_type) VALUES ($1, $2, 'server') RETURNING id`,
    [tenant.id, 'Verify Agent Server'],
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

  const agentTokens = app.get(AgentTokensService);
  const monitors = app.get(MonitorsService);
  const alertRules = app.get(AlertRulesService);
  const scheduler = app.get(MonitorSchedulerService);

  try {
    const created = await agentTokens.create(tenant.id, {
      resourceId: resource.id,
      label: 'Verify Device',
    });
    assert(
      typeof created.token === 'string' && created.token.length > 0,
      'create() returns a signed device token',
    );
    assert(
      created.is_enabled === true,
      'a new agent token is enabled by default',
    );

    // --- Guard rejects bad/missing tokens ---
    const noAuth = await fetch(`${baseUrl}/agent/heartbeat`, {
      method: 'POST',
    });
    assert(
      noAuth.status === 401,
      'heartbeat without a token is rejected with 401',
    );

    const badToken = await fetch(`${baseUrl}/agent/heartbeat`, {
      method: 'POST',
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    assert(
      badToken.status === 401,
      'heartbeat with a garbage token is rejected with 401',
    );

    // --- Heartbeat updates last_seen_at ---
    const hbBefore = await agentTokens.list(tenant.id);
    assert(
      hbBefore[0].last_seen_at === null,
      'a fresh token has never been seen',
    );

    const hbRes = await fetch(`${baseUrl}/agent/heartbeat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${created.token}` },
    });
    assert(hbRes.status === 204, 'a valid heartbeat is accepted with 204');
    const hbAfter = await agentTokens.list(tenant.id);
    assert(hbAfter[0].last_seen_at !== null, 'heartbeat updates last_seen_at');

    // --- Revocation ---
    await agentTokens.update(tenant.id, created.id, { isEnabled: false });
    const revokedRes = await fetch(`${baseUrl}/agent/heartbeat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${created.token}` },
    });
    assert(
      revokedRes.status === 401,
      'a revoked (is_enabled=false) token is rejected even though the JWT itself is still validly signed',
    );
    await agentTokens.update(tenant.id, created.id, { isEnabled: true });

    // --- Report evaluates against a server_agent monitor and opens an alert on repeated critical reports ---
    const monitor = await monitors.create(tenant.id, {
      resourceId: resource.id,
      name: 'Verify Agent Monitor',
      monitorType: 'server_agent',
      config: { cpuCriticalPercent: 90 },
      consecutiveFailuresToAlert: 2,
    });
    await alertRules.create(tenant.id, {
      monitorId: monitor.id,
      severity: 'critical',
    });

    const healthyReport = await fetch(`${baseUrl}/agent/report`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${created.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cpuPercent: 20, memPercent: 30, diskPercent: 40 }),
    });
    assert(healthyReport.status === 204, 'a healthy report is accepted');
    const { rows: healthyChecks } = await migrator.query(
      `SELECT status FROM monitor_checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 1`,
      [monitor.id],
    );
    assert(
      healthyChecks[0].status === 'up',
      'a report under all thresholds records status=up',
    );

    for (let i = 0; i < 2; i++) {
      await fetch(`${baseUrl}/agent/report`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${created.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cpuPercent: 97 }),
      });
    }
    const { rows: alertRows } = await migrator.query(
      `SELECT * FROM alerts WHERE monitor_id = $1`,
      [monitor.id],
    );
    assert(
      alertRows.length === 1,
      'two consecutive critical CPU reports open exactly one alert',
    );
    assert(
      alertRows[0].ticket_id !== null,
      'the agent-report-driven alert links a real ticket, same as any other monitor type',
    );

    // --- Staleness sweep: a monitor with no recent report/heartbeat is marked down ---
    const staleMonitor = await monitors.create(tenant.id, {
      resourceId: resource.id,
      name: 'Verify Stale Agent Monitor',
      monitorType: 'server_agent',
      intervalSeconds: 10,
      consecutiveFailuresToAlert: 1,
    });
    // No agent_token exists for this scenario's resource association timing --
    // force staleness by predating monitor_checks so the sweep sees it as due.
    await migrator.query(
      `UPDATE agent_tokens SET last_seen_at = now() - interval '1 hour' WHERE id = $1`,
      [created.id],
    );
    await scheduler.runSweepOnce();
    const { rows: staleChecks } = await migrator.query(
      `SELECT status, raw_output FROM monitor_checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 1`,
      [staleMonitor.id],
    );
    assert(
      staleChecks.length === 1,
      'the staleness sweep records a check for a due server_agent monitor',
    );
    assert(
      staleChecks[0].status === 'down',
      'a resource whose agent has not reported within the staleness threshold is marked down',
    );

    console.log('\nAll agent checks passed.');
  } finally {
    await app.close();
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
    await migrator.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
