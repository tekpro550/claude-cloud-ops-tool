const TEST_PORT = 35000 + Math.floor(Math.random() * 500);
process.env.PORT = String(TEST_PORT);
process.env.INTERNAL_API_BASE_URL = `http://localhost:${TEST_PORT}/api/v1`;

import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { CLOUD_PROVIDER_CLIENT_FACTORY } from '../cloud/cloud-provider-client';
import {
  FakeCloudProviderClient,
  makeFakeFactory,
} from './fake-cloud-provider-client';
import { MonitoringDashboardService } from '../monitoring-dashboard.service';
import { MonitorsService } from '../monitors.service';
import { ResourcesService } from '../resources.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Monitoring dashboard verification FAILED: ${message}`);
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

  const slug = `monitoring-dashboard-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Monitoring Dashboard Verify', slug],
  );

  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOUD_PROVIDER_CLIENT_FACTORY)
    .useValue(
      makeFakeFactory({ aws: new FakeCloudProviderClient('aws', [], {}) }),
    )
    .compile();

  const app: INestApplication = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(TEST_PORT);

  const resources = app.get(ResourcesService);
  const monitors = app.get(MonitorsService);
  const dashboard = app.get(MonitoringDashboardService);

  try {
    const makeResourceWithStatus = async (
      name: string,
      status: string | null,
    ) => {
      const resource = await resources.create(tenant.id, {
        name,
        resourceType: 'server',
      });
      if (status === null) return resource;
      const monitor = await monitors.create(tenant.id, {
        resourceId: resource.id,
        name: `${name} check`,
        monitorType: 'http',
      });
      await migrator.query(
        `INSERT INTO monitor_checks (tenant_id, monitor_id, status, raw_output) VALUES ($1, $2, $3, '{}')`,
        [tenant.id, monitor.id, status],
      );
      return { resource, monitor };
    };

    const upRes = await makeResourceWithStatus('up-resource', 'up');
    const downRes = await makeResourceWithStatus('down-resource', 'down');
    const criticalRes = await makeResourceWithStatus(
      'critical-resource',
      'critical',
    );
    await makeResourceWithStatus('trouble-resource', 'trouble');
    await makeResourceWithStatus('no-monitor-resource', null);

    const summary = await dashboard.summary(tenant.id);
    assert(
      summary.resources.total === 5,
      `resources.total counts all 5 resources (got ${summary.resources.total})`,
    );
    assert(
      summary.resources.up === 1,
      `resources.up counts the up resource (got ${summary.resources.up})`,
    );
    assert(
      summary.resources.down === 1,
      `resources.down counts the down resource (got ${summary.resources.down})`,
    );
    assert(
      summary.resources.critical === 1,
      `resources.critical counts the critical resource (got ${summary.resources.critical})`,
    );
    assert(
      summary.resources.trouble === 1,
      `resources.trouble counts the trouble resource (got ${summary.resources.trouble})`,
    );
    assert(
      summary.resources.none === 1,
      `resources.none counts the resource with no monitor (got ${summary.resources.none})`,
    );
    assert(
      summary.monitors.total === 4,
      `monitors.total counts all 4 created monitors (got ${summary.monitors.total})`,
    );
    assert(
      summary.monitors.enabled === 4,
      `monitors.enabled counts all 4 (all enabled by default) (got ${summary.monitors.enabled})`,
    );

    // --- Alerts: monitor-driven counted, cost-driven excluded ---
    const anyMonitorId = (upRes as any).monitor.id;
    await migrator.query(
      `INSERT INTO alerts (tenant_id, monitor_id, severity, status, reason_text, opened_at)
       VALUES ($1, $2, 'critical', 'open', 'critical alert', now())`,
      [tenant.id, anyMonitorId],
    );
    const secondMonitorId = (downRes as any).monitor.id;
    await migrator.query(
      `INSERT INTO alerts (tenant_id, monitor_id, severity, status, reason_text, opened_at)
       VALUES ($1, $2, 'warning', 'acknowledged', 'warning alert', now())`,
      [tenant.id, secondMonitorId],
    );
    const thirdMonitorId = (criticalRes as any).monitor.id;
    await migrator.query(
      `INSERT INTO alerts (tenant_id, monitor_id, severity, status, reason_text, opened_at, resolved_at)
       VALUES ($1, $2, 'info', 'resolved', 'resolved alert', now() - interval '1 day', now())`,
      [tenant.id, thirdMonitorId],
    );

    // A cost-budget-driven alert (monitor_id NULL) -- must not be counted here.
    const {
      rows: [credential],
    } = await migrator.query(
      `INSERT INTO cloud_credentials (tenant_id, provider, label, config_encrypted, is_enabled)
       VALUES ($1, 'aws', 'unrelated cost credential', pgp_sym_encrypt('{}', $2), true) RETURNING id`,
      [
        tenant.id,
        process.env.CREDENTIALS_ENCRYPTION_KEY ??
          'dev-only-credentials-key-change-me-in-prod',
      ],
    );
    const {
      rows: [budget],
    } = await migrator.query(
      `INSERT INTO cost_budgets (tenant_id, cloud_credential_id, name) VALUES ($1, $2, 'unrelated budget') RETURNING id`,
      [tenant.id, credential.id],
    );
    await migrator.query(
      `INSERT INTO alerts (tenant_id, cost_budget_id, severity, status, reason_text, opened_at)
       VALUES ($1, $2, 'critical', 'open', 'cost alert, not monitoring', now())`,
      [tenant.id, budget.id],
    );

    const summaryAfterAlerts = await dashboard.summary(tenant.id);
    assert(
      summaryAfterAlerts.openAlerts.total === 2,
      `openAlerts.total counts only the 2 open/acknowledged monitor alerts, excluding the resolved one and the cost alert (got ${summaryAfterAlerts.openAlerts.total})`,
    );
    assert(
      summaryAfterAlerts.openAlerts.critical === 1,
      `openAlerts.critical counts 1 (got ${summaryAfterAlerts.openAlerts.critical})`,
    );
    assert(
      summaryAfterAlerts.openAlerts.warning === 1,
      `openAlerts.warning counts 1 (got ${summaryAfterAlerts.openAlerts.warning})`,
    );

    // --- Trends: today's opened + resolved counts show up ---
    const trends = await dashboard.trends(tenant.id, 14);
    assert(
      trends.length === 14,
      `trends returns exactly 14 days (got ${trends.length})`,
    );
    const today = trends[trends.length - 1];
    assert(
      today.created === 2,
      `today's trend point counts 2 alerts opened today (got ${today.created})`,
    );
    assert(
      today.resolved === 1,
      `today's trend point counts 1 alert resolved today (got ${today.resolved})`,
    );

    console.log('\nAll monitoring dashboard checks passed.');
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
