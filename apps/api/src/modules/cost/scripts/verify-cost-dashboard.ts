const TEST_PORT = 35500 + Math.floor(Math.random() * 500);
process.env.PORT = String(TEST_PORT);
process.env.INTERNAL_API_BASE_URL = `http://localhost:${TEST_PORT}/api/v1`;

import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { CLOUD_PROVIDER_CLIENT_FACTORY } from '../../monitoring/cloud/cloud-provider-client';
import { CloudCredentialsService } from '../../monitoring/cloud-credentials.service';
import {
  FakeCloudProviderClient,
  makeFakeFactory,
} from '../../monitoring/scripts/fake-cloud-provider-client';
import { ResourcesService } from '../../monitoring/resources.service';
import { CostDashboardService } from '../cost-dashboard.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Cost dashboard verification FAILED: ${message}`);
  }
  console.log(`  OK  ${message}`);
}

function approxEqual(a: number, b: number, epsilon = 0.01) {
  return Math.abs(a - b) < epsilon;
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

  const slug = `cost-dashboard-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Cost Dashboard Verify', slug],
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

  const cloudCredentials = app.get(CloudCredentialsService);
  const resources = app.get(ResourcesService);
  const dashboard = app.get(CostDashboardService);

  try {
    // Two connected accounts, spend split across both so the dashboard's
    // aggregate has to actually sum across accounts, not just read one.
    const credA = await cloudCredentials.create(tenant.id, {
      provider: 'aws',
      label: 'Dashboard Verify Account A',
      config: { region: 'us-east-1', accessKeyId: 'x', secretAccessKey: 'y' },
    });
    const credB = await cloudCredentials.create(tenant.id, {
      provider: 'aws',
      label: 'Dashboard Verify Account B',
      config: { region: 'us-east-1', accessKeyId: 'x', secretAccessKey: 'y' },
    });

    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const daysElapsed = now.getUTCDate();
    const daysInMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const daysInPrevMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0),
    ).getUTCDate();

    // Previous month: $600 + $400 = $1000 total across both accounts.
    const prevMonthStart = new Date(monthStart);
    prevMonthStart.setUTCDate(prevMonthStart.getUTCDate() - daysInPrevMonth);
    for (let d = 0; d < daysInPrevMonth; d++) {
      const date = new Date(prevMonthStart);
      date.setUTCDate(date.getUTCDate() + d);
      const dateStr = date.toISOString().slice(0, 10);
      await migrator.query(
        `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount, currency)
         VALUES ($1, $2, 'Amazon EC2', 'us-east-1', $3, $4, 'USD')`,
        [tenant.id, credA.id, dateStr, 600 / daysInPrevMonth],
      );
      await migrator.query(
        `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount, currency)
         VALUES ($1, $2, 'Amazon EC2', 'us-east-1', $3, $4, 'USD')`,
        [tenant.id, credB.id, dateStr, 400 / daysInPrevMonth],
      );
    }

    // Current month: $1200 + $800 = $2000 full-month-equivalent across both.
    for (let d = 0; d < daysElapsed; d++) {
      const date = new Date(monthStart);
      date.setUTCDate(date.getUTCDate() + d);
      const dateStr = date.toISOString().slice(0, 10);
      await migrator.query(
        `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount, currency)
         VALUES ($1, $2, 'Amazon EC2', 'us-east-1', $3, $4, 'USD')`,
        [tenant.id, credA.id, dateStr, 1200 / daysInMonth],
      );
      await migrator.query(
        `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount, currency)
         VALUES ($1, $2, 'Amazon EC2', 'us-east-1', $3, $4, 'USD')`,
        [tenant.id, credB.id, dateStr, 800 / daysInMonth],
      );
    }

    const expectedMtd = daysElapsed * (1200 / daysInMonth + 800 / daysInMonth);

    // A resolved recommendation shouldn't count; an open one should.
    const resourceForRec = await resources.create(tenant.id, {
      name: 'dashboard-verify-instance',
      resourceType: 'server',
    });
    await migrator.query(
      `INSERT INTO rightsizing_recommendations (tenant_id, resource_id, recommendation_type, reason_text, status)
       VALUES ($1, $2, 'idle', 'idle instance', 'open')`,
      [tenant.id, resourceForRec.id],
    );
    await migrator.query(
      `INSERT INTO rightsizing_recommendations (tenant_id, resource_id, recommendation_type, reason_text, status)
       VALUES ($1, $2, 'rightsize', 'resolved rec', 'resolved')`,
      [tenant.id, resourceForRec.id],
    );

    // An open cost-budget alert and a resolved one -- only the open one counts.
    const {
      rows: [budget],
    } = await migrator.query(
      `INSERT INTO cost_budgets (tenant_id, cloud_credential_id, name) VALUES ($1, $2, 'dashboard verify budget') RETURNING id`,
      [tenant.id, credA.id],
    );
    await migrator.query(
      `INSERT INTO alerts (tenant_id, cost_budget_id, severity, status, reason_text)
       VALUES ($1, $2, 'critical', 'open', 'over pace')`,
      [tenant.id, budget.id],
    );

    // A monitor-driven alert (monitor_id set) must NOT count here -- it belongs to Module 2's dashboard.
    const resourceForMonitor = await resources.create(tenant.id, {
      name: 'unrelated-monitored-resource',
      resourceType: 'server',
    });
    const {
      rows: [monitor],
    } = await migrator.query(
      `INSERT INTO monitors (tenant_id, resource_id, name, monitor_type) VALUES ($1, $2, 'unrelated check', 'http') RETURNING id`,
      [tenant.id, resourceForMonitor.id],
    );
    await migrator.query(
      `INSERT INTO alerts (tenant_id, monitor_id, severity, status, reason_text)
       VALUES ($1, $2, 'critical', 'open', 'monitoring alert, not cost')`,
      [tenant.id, monitor.id],
    );

    const summary = await dashboard.summary(tenant.id);
    assert(
      approxEqual(summary.previousMonthTotal, 1000),
      `previousMonthTotal aggregates both accounts to 1000 (got ${summary.previousMonthTotal})`,
    );
    assert(
      approxEqual(summary.mtdSpend, expectedMtd),
      `mtdSpend aggregates both accounts (got ${summary.mtdSpend}, expected ${expectedMtd})`,
    );
    assert(
      approxEqual(summary.forecast, 2000),
      `forecast projects to exactly 2000 for the full month (got ${summary.forecast})`,
    );
    assert(
      approxEqual(summary.forecastPctChange, 100),
      `forecast is 100% over last month's aggregate baseline (got ${summary.forecastPctChange})`,
    );
    assert(
      summary.connectedAccounts === 2,
      `connectedAccounts counts both accounts (got ${summary.connectedAccounts})`,
    );
    assert(
      summary.openBudgetAlerts === 1,
      `openBudgetAlerts counts only the cost alert, not the monitoring alert (got ${summary.openBudgetAlerts})`,
    );
    assert(
      summary.openRecommendations === 1,
      `openRecommendations counts only the open recommendation, not the resolved one (got ${summary.openRecommendations})`,
    );

    const trend = await dashboard.trend(tenant.id);
    assert(
      trend.length >= 2,
      `trend covers at least the previous and current month (got ${trend.length} points)`,
    );
    const currentMonthKey = monthStart.toISOString().slice(0, 7);
    const currentMonthPoint = trend.find(
      (p: any) => p.month === currentMonthKey,
    );
    assert(!!currentMonthPoint, 'trend includes a point for the current month');
    assert(
      approxEqual(Number(currentMonthPoint.total), expectedMtd),
      `the current month's trend total matches mtdSpend (got ${currentMonthPoint.total}, expected ${expectedMtd})`,
    );

    console.log('\nAll cost dashboard checks passed.');
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
