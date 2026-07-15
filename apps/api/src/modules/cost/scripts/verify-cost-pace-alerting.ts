const TEST_PORT = 32900 + Math.floor(Math.random() * 500);
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
import { CostBudgetsService } from '../cost-budgets.service';
import { CostPaceCheckService } from '../cost-pace-check.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Cost pace alerting verification FAILED: ${message}`);
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

  const slug = `cost-pace-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Cost Pace Verify', slug],
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
  const budgets = app.get(CostBudgetsService);
  const paceCheck = app.get(CostPaceCheckService);

  try {
    const credential = await cloudCredentials.create(tenant.id, {
      provider: 'aws',
      label: 'Verify AWS billing account',
      config: { region: 'us-east-1', accessKeyId: 'x', secretAccessKey: 'y' },
    });

    // Seed cost_line_items directly. Amounts are deliberately derived from
    // daysInMonth/daysElapsed (not hardcoded), so the resulting projected
    // full-month total is always exactly $2000 regardless of which real
    // calendar day this script happens to run on: mtd_spend = daysElapsed *
    // (2000 / daysInMonth), so (mtd_spend / daysElapsed) * daysInMonth
    // collapses to exactly 2000 every time.
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const daysElapsed = now.getUTCDate();
    const daysInMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const perDayAmount = 2000 / daysInMonth;

    for (let d = 0; d < daysElapsed; d++) {
      const date = new Date(monthStart);
      date.setUTCDate(date.getUTCDate() + d);
      await migrator.query(
        `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount, currency)
         VALUES ($1, $2, 'Amazon EC2', 'us-east-1', $3, $4, 'USD')`,
        [
          tenant.id,
          credential.id,
          date.toISOString().slice(0, 10),
          perDayAmount,
        ],
      );
    }

    const prevMonthEnd = new Date(monthStart);
    prevMonthEnd.setUTCDate(0);
    await migrator.query(
      `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount, currency)
       VALUES ($1, $2, 'Amazon EC2', 'us-east-1', $3, 1000, 'USD')`,
      [tenant.id, credential.id, prevMonthEnd.toISOString().slice(0, 10)],
    );

    // --- Budget 1: no monthly_budget_amount -- pace-only against last month's $1000 ---
    const budgetNoCap = await budgets.create(tenant.id, {
      name: 'Pace-only budget',
      cloudCredentialId: credential.id,
    });

    const alertedCount = await paceCheck.checkTenant(tenant.id);
    assert(
      alertedCount >= 1,
      `checkTenant() reports at least 1 budget alerted (got ${alertedCount})`,
    );

    const { rows: alertsAfterFirst } = await migrator.query(
      `SELECT * FROM alerts WHERE cost_budget_id = $1`,
      [budgetNoCap.id],
    );
    assert(
      alertsAfterFirst.length === 1,
      'projecting 2x last month opens exactly one alert',
    );
    assert(
      alertsAfterFirst[0].severity === 'critical',
      `projecting 100% over last month's pace ($2000 vs $1000) is severity=critical (got ${alertsAfterFirst[0].severity})`,
    );
    assert(
      alertsAfterFirst[0].reason_text.includes('Pace-only budget'),
      'the alert reason_text names the budget',
    );

    // --- Re-run: same data, no duplicate alert, no duplicate notification ---
    await paceCheck.checkTenant(tenant.id);
    const { rows: alertsAfterSecond } = await migrator.query(
      `SELECT id FROM alerts WHERE cost_budget_id = $1`,
      [budgetNoCap.id],
    );
    assert(
      alertsAfterSecond.length === 1,
      'a second identical check does not open a duplicate alert',
    );

    // --- Budget 2: a hard monthly_budget_amount already exceeded by MTD spend alone ---
    const budgetHardCap = await budgets.create(tenant.id, {
      name: 'Hard cap budget',
      cloudCredentialId: credential.id,
      // $50 is deliberately far below even the smallest possible MTD spend
      // this seed data can produce (2000/31 on day 1 of a 31-day month,
      // ~$64.50, only growing from there) -- guarantees mtd_spend actually
      // exceeds the cap outright, not just the pace projection, regardless
      // of which real calendar day this script runs on.
      monthlyBudgetAmount: 50,
      notifyChannel: 'email',
      notifyRecipient: 'ops@example.com',
    });
    await paceCheck.checkTenant(tenant.id);
    const { rows: hardCapAlerts } = await migrator.query(
      `SELECT * FROM alerts WHERE cost_budget_id = $1`,
      [budgetHardCap.id],
    );
    assert(
      hardCapAlerts.length === 1,
      'the hard-cap budget also opens exactly one alert',
    );
    assert(
      hardCapAlerts[0].severity === 'critical',
      'MTD spend already exceeding the hard cap is severity=critical',
    );

    const { rows: notificationRows } = await migrator.query(
      `SELECT * FROM notifications WHERE tenant_id = $1 AND recipient = 'ops@example.com'`,
      [tenant.id],
    );
    assert(
      notificationRows.length === 1,
      'a budget with notify_channel/notify_recipient set gets exactly one notification enqueued on open',
    );
    assert(
      notificationRows[0].channel === 'email',
      "the notification uses the budget's configured channel",
    );

    // --- Spend drops back under pace -- the alert resolves ---
    await migrator.query(
      `DELETE FROM cost_line_items WHERE tenant_id = $1 AND cloud_credential_id = $2 AND usage_date >= $3`,
      [tenant.id, credential.id, monthStart.toISOString().slice(0, 10)],
    );
    await migrator.query(
      `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount, currency)
       VALUES ($1, $2, 'Amazon EC2', 'us-east-1', $3, 10, 'USD')`,
      [tenant.id, credential.id, monthStart.toISOString().slice(0, 10)],
    );
    await paceCheck.checkTenant(tenant.id);
    const { rows: resolvedAlerts } = await migrator.query(
      `SELECT status FROM alerts WHERE cost_budget_id = $1`,
      [budgetNoCap.id],
    );
    assert(
      resolvedAlerts[0].status === 'resolved',
      'spend dropping back under pace resolves the open alert',
    );

    console.log('\nAll cost pace alerting checks passed.');
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
