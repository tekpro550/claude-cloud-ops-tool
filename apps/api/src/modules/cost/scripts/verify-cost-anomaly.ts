import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { detectAnomaly } from '../cost-anomaly-detect';
import { CostAnomaliesService } from '../cost-anomalies.service';
import { CostAnomalyCheckService } from '../cost-anomaly-check.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Cost anomaly verification FAILED: ${message}`);
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
  // --- Pure detector cases ---
  assert(
    detectAnomaly(100, 300).isAnomaly,
    'a 3x jump over a real baseline is an anomaly',
  );
  assert(
    !detectAnomaly(100, 120).isAnomaly,
    'a 20% rise (below the 50% threshold) is not an anomaly',
  );
  assert(
    !detectAnomaly(0.01, 0.04).isAnomaly,
    'a tiny absolute jump (cents) is not an anomaly even at a huge percentage',
  );
  assert(
    detectAnomaly(0, 50).isAnomaly,
    'new spend against a zero baseline is flagged',
  );

  // --- End-to-end sweep over seeded line items ---
  const migrator = migratorClient();
  await migrator.connect();
  const slug = `cost-anomaly-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Cost Anomaly Verify', slug],
  );
  const {
    rows: [cred],
  } = await migrator.query(
    `INSERT INTO cloud_credentials (tenant_id, provider, label, config_encrypted)
     VALUES ($1, 'aws', 'anomaly test', pgp_sym_encrypt('{}', $2)) RETURNING id`,
    [
      tenant.id,
      process.env.CREDENTIALS_ENCRYPTION_KEY ??
        'dev-only-credentials-key-change-me-in-prod',
    ],
  );

  // 14 baseline days of ~$10/day EC2, then a $300 spike on the latest day.
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  for (let i = 15; i >= 1; i -= 1) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    await migrator.query(
      `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount)
       VALUES ($1, $2, 'EC2', 'us-east-1', $3, 10)`,
      [tenant.id, cred.id, iso(d)],
    );
  }
  const spikeDay = new Date(today);
  spikeDay.setUTCDate(spikeDay.getUTCDate() - 0);
  await migrator.query(
    `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount)
     VALUES ($1, $2, 'EC2', 'us-east-1', $3, 300)`,
    [tenant.id, cred.id, iso(spikeDay)],
  );
  // A steady service that should NOT be flagged.
  for (let i = 15; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    await migrator.query(
      `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount)
       VALUES ($1, $2, 'S3', 'us-east-1', $3, 5)`,
      [tenant.id, cred.id, iso(d)],
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const check = app.get(CostAnomalyCheckService);
  const anomalies = app.get(CostAnomaliesService);

  try {
    const recorded = await check.checkTenant(tenant.id);
    assert(
      recorded === 1,
      `the sweep records exactly the EC2 spike (got ${recorded})`,
    );

    const list = await anomalies.list(tenant.id);
    assert(
      list.length === 1 && list[0].service === 'EC2',
      'the open anomaly is the EC2 spike',
    );
    assert(
      Number(list[0].actual_amount) === 300,
      "the anomaly captures the spike day's actual spend",
    );

    // A re-sweep must not duplicate.
    await check.checkTenant(tenant.id);
    const list2 = await anomalies.list(tenant.id);
    assert(
      list2.length === 1,
      'a re-sweep updates in place rather than duplicating',
    );

    // Dismiss removes it from the open list.
    await anomalies.dismiss(tenant.id, list2[0].id);
    const list3 = await anomalies.list(tenant.id);
    assert(
      list3.length === 0,
      'dismissing an anomaly drops it from the open list',
    );

    console.log('\nAll cost anomaly checks passed.');
  } finally {
    await migrator.query(`DELETE FROM cost_anomalies WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM cost_line_items WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM cloud_credentials WHERE tenant_id = $1`, [
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
