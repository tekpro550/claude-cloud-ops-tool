import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { forecastDaysToFull } from '../disk-forecast';
import { DiskForecastSweepService } from '../disk-forecast-sweep.service';
import { DiskForecastsService } from '../disk-forecasts.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Disk forecast verification FAILED: ${message}`);
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
  // --- Pure forecast ---
  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  // Rising 5%/day from 60% -> full in ~8 days.
  const rising = forecastDaysToFull(
    Array.from({ length: 6 }, (_, i) => ({
      t: now - (5 - i) * day,
      value: 60 + i * 5,
    })),
  );
  assert(rising !== null, 'a steadily rising disk yields a forecast');
  assert(
    // Samples end at 85% climbing 5%/day, so full in (100-85)/5 = 3 days.
    rising!.daysToFull >= 2 && rising!.daysToFull <= 4,
    `a 5%/day climb ending at 85% projects full in ~3 days (got ${rising!.daysToFull})`,
  );
  const flat = forecastDaysToFull(
    Array.from({ length: 6 }, (_, i) => ({
      t: now - (5 - i) * day,
      value: 40,
    })),
  );
  assert(flat === null, 'a flat disk yields no forecast');
  const draining = forecastDaysToFull(
    Array.from({ length: 6 }, (_, i) => ({
      t: now - (5 - i) * day,
      value: 80 - i * 3,
    })),
  );
  assert(draining === null, 'a shrinking disk yields no forecast');

  // --- End-to-end sweep ---
  const migrator = migratorClient();
  await migrator.connect();
  const slug = `disk-forecast-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Disk Forecast Verify', slug],
  );
  const {
    rows: [resource],
  } = await migrator.query(
    `INSERT INTO resources (tenant_id, name, resource_type) VALUES ($1, 'web-01', 'server') RETURNING id`,
    [tenant.id],
  );
  const {
    rows: [monitor],
  } = await migrator.query(
    `INSERT INTO monitors (tenant_id, resource_id, name, monitor_type, config) VALUES ($1, $2, 'web-01 agent', 'server_agent', '{}') RETURNING id`,
    [tenant.id, resource.id],
  );
  // 6 daily checks climbing 70 -> 95 (fills soon).
  for (let i = 5; i >= 0; i -= 1) {
    await migrator.query(
      `INSERT INTO monitor_checks (tenant_id, monitor_id, status, raw_output, checked_at)
       VALUES ($1, $2, 'up', $3, now() - ($4 || ' days')::interval)`,
      [
        tenant.id,
        monitor.id,
        JSON.stringify({ diskPercent: 70 + (5 - i) * 5 }),
        i,
      ],
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const sweep = app.get(DiskForecastSweepService);
  const forecasts = app.get(DiskForecastsService);

  try {
    const recorded = await sweep.runSweepOnce();
    assert(
      recorded >= 1,
      `the sweep records the filling disk (got ${recorded})`,
    );

    const list = await forecasts.list(tenant.id);
    const mine = list.filter(
      (f: { monitor_id: string }) => f.monitor_id === monitor.id,
    );
    assert(
      mine.length === 1,
      'the filling monitor has exactly one open forecast',
    );
    assert(
      Number(mine[0].days_to_full) <= 14 && Number(mine[0].days_to_full) >= 0,
      `the forecast projects full within the horizon (got ${mine[0].days_to_full} days)`,
    );

    // A re-sweep refreshes in place.
    await sweep.runSweepOnce();
    const list2 = (await forecasts.list(tenant.id)).filter(
      (f: { monitor_id: string }) => f.monitor_id === monitor.id,
    );
    assert(
      list2.length === 1,
      'a re-sweep refreshes the forecast in place, not duplicated',
    );

    // Dismiss.
    await forecasts.dismiss(tenant.id, list2[0].id);
    const list3 = (await forecasts.list(tenant.id)).filter(
      (f: { monitor_id: string }) => f.monitor_id === monitor.id,
    );
    assert(
      list3.length === 0,
      'dismissing drops the forecast from the open list',
    );

    console.log('\nAll disk forecast checks passed.');
  } finally {
    await migrator.query(`DELETE FROM disk_forecasts WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM monitor_checks WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM monitors WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM resources WHERE tenant_id = $1`, [
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
