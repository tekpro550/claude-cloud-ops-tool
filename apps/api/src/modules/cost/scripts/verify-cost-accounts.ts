const TEST_PORT = 33000 + Math.floor(Math.random() * 500);
process.env.PORT = String(TEST_PORT);
process.env.INTERNAL_API_BASE_URL = `http://localhost:${TEST_PORT}/api/v1`;

import 'dotenv/config';
import { randomUUID } from 'crypto';
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
import { CostAccountsService } from '../cost-accounts.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Cost accounts verification FAILED: ${message}`);
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

  const slug = `cost-accounts-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Cost Accounts Verify', slug],
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
  const accounts = app.get(CostAccountsService);

  try {
    const credentialA = await cloudCredentials.create(tenant.id, {
      provider: 'aws',
      label: 'Rollup Verify Account A',
      config: { region: 'us-east-1', accessKeyId: 'x', secretAccessKey: 'y' },
    });
    const credentialB = await cloudCredentials.create(tenant.id, {
      provider: 'aws',
      label: 'Rollup Verify Account B',
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

    // Previous month: a fixed $1000 total for credential A, spread evenly
    // over every day of the previous month so it sums to exactly 1000
    // regardless of how many days that month actually has.
    const prevMonthPerDay = 1000 / daysInPrevMonth;
    const prevMonthStart = new Date(monthStart);
    prevMonthStart.setUTCDate(prevMonthStart.getUTCDate() - daysInPrevMonth);
    for (let d = 0; d < daysInPrevMonth; d++) {
      const date = new Date(prevMonthStart);
      date.setUTCDate(date.getUTCDate() + d);
      await migrator.query(
        `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount, currency)
         VALUES ($1, $2, 'Amazon EC2', 'us-east-1', $3, $4, 'USD')`,
        [
          tenant.id,
          credentialA.id,
          date.toISOString().slice(0, 10),
          prevMonthPerDay,
        ],
      );
    }

    // Current month: a fixed $2000 full-month-equivalent total for
    // credential A, split 70/30 between EC2/us-east-1 and S3/us-west-2 so
    // the top-services/top-regions breakdown has a deterministic order.
    // Per-day amount is divided by daysInMonth (not daysElapsed) so the
    // eventual projectedFullMonth forecast always collapses to exactly
    // 2000, the same trick verify-cost-pace-alerting.ts uses.
    const currMonthPerDay = 2000 / daysInMonth;
    for (let d = 0; d < daysElapsed; d++) {
      const date = new Date(monthStart);
      date.setUTCDate(date.getUTCDate() + d);
      const dateStr = date.toISOString().slice(0, 10);
      await migrator.query(
        `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount, currency)
         VALUES ($1, $2, 'Amazon EC2', 'us-east-1', $3, $4, 'USD')`,
        [tenant.id, credentialA.id, dateStr, currMonthPerDay * 0.7],
      );
      await migrator.query(
        `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount, currency)
         VALUES ($1, $2, 'Amazon S3', 'us-west-2', $3, $4, 'USD')`,
        [tenant.id, credentialA.id, dateStr, currMonthPerDay * 0.3],
      );
    }

    const expectedMtd = daysElapsed * currMonthPerDay;
    const expectedPrevSamePeriod = daysElapsed * prevMonthPerDay;
    const expectedMtdPctChange =
      ((expectedMtd - expectedPrevSamePeriod) / expectedPrevSamePeriod) * 100;

    // --- accounts_summary: both accounts show up, one card each ---
    const summaries = await accounts.accountsSummary(tenant.id);
    assert(
      summaries.length === 2,
      `accounts_summary returns one card per account (got ${summaries.length})`,
    );

    const summaryA = summaries.find(
      (s: any) => s.cloudCredentialId === credentialA.id,
    );
    const summaryB = summaries.find(
      (s: any) => s.cloudCredentialId === credentialB.id,
    );
    assert(
      !!summaryA && !!summaryB,
      'both accounts are represented by cloud_credential_id',
    );

    assert(
      approxEqual(summaryA.previousMonthTotal, 1000),
      `previous month total is exactly 1000 (got ${summaryA.previousMonthTotal})`,
    );
    assert(
      approxEqual(summaryA.mtdSpend, expectedMtd),
      `MTD spend matches the seeded per-day total (got ${summaryA.mtdSpend}, expected ${expectedMtd})`,
    );
    assert(
      approxEqual(summaryA.forecast, 2000),
      `forecast projects to exactly 2000 for the full month (got ${summaryA.forecast})`,
    );
    assert(
      approxEqual(summaryA.forecastPctChange, 100),
      `forecast is 100% over last month's baseline (got ${summaryA.forecastPctChange})`,
    );
    assert(
      approxEqual(summaryA.mtdPctChange, expectedMtdPctChange),
      `MTD % change matches the same-day-count comparison against last month (got ${summaryA.mtdPctChange}, expected ${expectedMtdPctChange})`,
    );
    assert(
      typeof summaryA.insightText === 'string' &&
        summaryA.insightText.includes('Rollup Verify Account A'),
      'insightText names the account, reusing generateCostInsightText()',
    );
    assert(
      summaryA.topServices[0]?.service === 'Amazon EC2',
      'top services ranks the 70% EC2 spend above the 30% S3 spend',
    );
    assert(
      summaryA.topRegions[0]?.region === 'us-east-1',
      'top regions ranks us-east-1 (EC2) above us-west-2 (S3)',
    );
    assert(
      Array.isArray(summaryA.trend) && summaryA.trend.length >= 2,
      `trend covers at least the previous and current month (got ${summaryA.trend?.length} points)`,
    );

    assert(
      summaryB.previousMonthTotal === null && summaryB.mtdSpend === 0,
      'an account with no cost data yet reports null previous-month total and zero MTD, not a crash',
    );
    assert(
      summaryB.forecast === null,
      'an account with no baseline (no budget, no last month data) has no forecast',
    );

    // --- per-account drill-down summary matches the rollup card ---
    const soloSummaryA = await accounts.accountSummary(
      tenant.id,
      credentialA.id,
    );
    assert(
      approxEqual(soloSummaryA.mtdSpend, summaryA.mtdSpend),
      'the per-account drill-down summary matches the rollup card for the same account',
    );

    // --- line items drill-down + filters ---
    const allLineItems = await accounts.lineItems(
      tenant.id,
      credentialA.id,
      {},
    );
    assert(
      allLineItems.length === daysInPrevMonth + daysElapsed * 2,
      `line_items returns every seeded row for the account (got ${allLineItems.length}, expected ${daysInPrevMonth + daysElapsed * 2})`,
    );

    const ec2Only = await accounts.lineItems(tenant.id, credentialA.id, {
      service: 'Amazon EC2',
    });
    assert(
      ec2Only.every((r: any) => r.service === 'Amazon EC2'),
      'service filter narrows line_items to only that service',
    );

    const westRegionOnly = await accounts.lineItems(tenant.id, credentialA.id, {
      region: 'us-west-2',
    });
    assert(
      westRegionOnly.length === daysElapsed &&
        westRegionOnly.every((r: any) => r.region === 'us-west-2'),
      `region filter narrows line_items to only that region (got ${westRegionOnly.length}, expected ${daysElapsed})`,
    );

    const dateRangeOnly = await accounts.lineItems(tenant.id, credentialA.id, {
      startDate: monthStart.toISOString().slice(0, 10),
    });
    assert(
      dateRangeOnly.length === daysElapsed * 2,
      `startDate filter excludes the previous month's rows (got ${dateRangeOnly.length}, expected ${daysElapsed * 2})`,
    );

    // --- a nonexistent credential 404s instead of silently returning nothing ---
    let notFoundThrew = false;
    try {
      await accounts.accountSummary(tenant.id, randomUUID());
    } catch {
      notFoundThrew = true;
    }
    assert(
      notFoundThrew,
      'accountSummary() for an unknown cloud_credential_id throws NotFoundException',
    );

    // --- disabling an account drops it out of the rollup ---
    await cloudCredentials.update(tenant.id, credentialB.id, {
      isEnabled: false,
    });
    const summariesAfterDisable = await accounts.accountsSummary(tenant.id);
    assert(
      summariesAfterDisable.length === 1 &&
        summariesAfterDisable[0].cloudCredentialId === credentialA.id,
      'a disabled cloud_credential drops out of accounts_summary',
    );

    console.log('\nAll cost accounts (MSP rollup) checks passed.');
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
