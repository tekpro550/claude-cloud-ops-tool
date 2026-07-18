import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { CostDashboardService } from '../cost-dashboard.service';
import { forecastMonthEnd, forecastMultiMonth } from '../forecast';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Cost forecast verification FAILED: ${message}`);
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

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  // ---- Pure function unit tests ----

  // Fewer than 7 elapsed days -- falls back to a flat linear projection.
  const shortMonth = forecastMonthEnd({
    elapsedDailySpend: [10, 10, 10],
    elapsedDayOfWeek: [1, 2, 3],
    remainingDayOfWeek: [4, 5, 6, 0, 1],
  });
  assert(
    shortMonth !== null && shortMonth.method === 'linear',
    'forecastMonthEnd falls back to a flat rate with under a week of data',
  );

  // A week of data with a clear weekday/weekend split, and the rest of the
  // month is entirely weekend days -- the weekday-weighted forecast should
  // project noticeably lower than a naive flat-average projection would.
  const weekdayMonth = forecastMonthEnd({
    elapsedDailySpend: [100, 100, 100, 100, 100, 20, 20],
    elapsedDayOfWeek: [1, 2, 3, 4, 5, 6, 0],
    remainingDayOfWeek: [6, 0, 6, 0, 6],
  });
  const naiveFlatProjection = 540 + (540 / 7) * 5; // overall average * remaining days, the old cost-pace.ts approach
  assert(
    weekdayMonth !== null &&
      weekdayMonth.method === 'weekday_weighted' &&
      weekdayMonth.projectedFullMonth < naiveFlatProjection - 50,
    `forecastMonthEnd's weekday weighting beats a naive flat-rate projection on a weekend-heavy remainder (got ${weekdayMonth?.projectedFullMonth.toFixed(2)} vs naive ${naiveFlatProjection.toFixed(2)})`,
  );
  assert(
    weekdayMonth !== null && Math.abs(weekdayMonth.mtdSpend - 540) < 0.01,
    'forecastMonthEnd reports the exact month-to-date spend',
  );

  assert(
    forecastMultiMonth([100, 120], 3) === null,
    'forecastMultiMonth refuses to trend fewer than 3 months of history',
  );

  const risingTrend = forecastMultiMonth([1000, 1500, 2000], 3);
  assert(
    risingTrend !== null &&
      risingTrend.slopePerMonth > 0 &&
      risingTrend.points.length === 3,
    'forecastMultiMonth detects a rising trend and projects the requested horizon',
  );
  assert(
    risingTrend !== null && risingTrend.points[0].projected > 2000,
    'the first projected month continues a rising trend above the last observed month',
  );
  assert(
    risingTrend !== null &&
      risingTrend.points.every(
        (p, i, arr) => i === 0 || p.projected > arr[i - 1].projected,
      ),
    'projections keep climbing further out on a consistent linear trend',
  );

  const flatTrend = forecastMultiMonth([500, 500, 500, 500], 2);
  assert(
    flatTrend !== null &&
      Math.abs(flatTrend.slopePerMonth) < 0.01 &&
      flatTrend.residualStddev < 0.01,
    'forecastMultiMonth reports ~zero slope and residual spread on a perfectly flat series',
  );

  // ---- End-to-end via CostDashboardService ----
  const migrator = migratorClient();
  await migrator.connect();
  const slug = `cost-forecast-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Cost Forecast Verify', slug],
  );
  const tenantId = tenant.id as string;
  const encryptionKey =
    process.env.CREDENTIALS_ENCRYPTION_KEY ??
    'dev-only-credentials-key-change-me-in-prod';
  const {
    rows: [cred],
  } = await migrator.query(
    `INSERT INTO cloud_credentials (tenant_id, provider, label, config_encrypted)
     VALUES ($1, 'aws', 'forecast test', pgp_sym_encrypt('{}', $2)) RETURNING id`,
    [tenantId, encryptionKey],
  );

  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  let expectedMtdSpend = 0;
  for (
    let d = new Date(monthStart);
    d <= today;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    await migrator.query(
      `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, usage_date, amount)
       VALUES ($1, $2, 'EC2', $3, 50)`,
      [tenantId, cred.id, iso(d)],
    );
    expectedMtdSpend += 50;
  }

  // Three complete prior months with a clear rising trend, independent of
  // wherever "today" happens to fall in its own month.
  const monthlyAmounts = [1000, 1500, 2000];
  for (let m = 3; m >= 1; m--) {
    const monthDate = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 15),
    );
    await migrator.query(
      `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, usage_date, amount)
       VALUES ($1, $2, 'RDS', $3, $4)`,
      [tenantId, cred.id, iso(monthDate), monthlyAmounts[3 - m]],
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const dashboard = app.get(CostDashboardService);

  try {
    const result = await dashboard.forecast(tenantId);
    assert(
      result.monthEnd !== null &&
        Math.abs(result.monthEnd.mtdSpend - expectedMtdSpend) < 0.01,
      `the service's month-end forecast reports the exact seeded month-to-date spend (got ${result.monthEnd?.mtdSpend}, expected ${expectedMtdSpend})`,
    );
    assert(
      result.monthEnd !== null &&
        result.monthEnd.projectedFullMonth >= result.monthEnd.mtdSpend,
      'the projected full month is never less than month-to-date spend',
    );
    assert(
      result.multiMonth !== null &&
        result.multiMonth.points.length === 3 &&
        result.multiMonth.slopePerMonth > 0,
      'the service detects the seeded rising trend across the three prior months',
    );

    // Scoping to an account with no cost data at all reports zeros (a true,
    // useful answer) rather than throwing; there's simply no month history
    // to trend, so multiMonth is null.
    const scoped = await dashboard.forecast(
      tenantId,
      '00000000-0000-4000-8000-000000000000',
    );
    assert(
      scoped.monthEnd !== null &&
        scoped.monthEnd.mtdSpend === 0 &&
        scoped.monthEnd.projectedFullMonth === 0,
      'forecasting for an account with no cost data reports zero spend rather than throwing',
    );
    assert(
      scoped.multiMonth === null,
      'forecasting for an account with no cost data has no trend to report',
    );

    console.log('\nAll cost forecast checks passed.');
  } finally {
    await app.close();
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await migrator.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
