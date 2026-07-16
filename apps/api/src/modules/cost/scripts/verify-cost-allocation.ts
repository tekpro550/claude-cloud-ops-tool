import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { normalizeAllocationTags } from '../cost-allocation';
import { CostAllocationService } from '../cost-allocation.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Cost allocation verification FAILED: ${message}`);
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
  // --- Pure tag normalization ---
  const normalized = normalizeAllocationTags({
    team: ' platform ',
    environment: 'prod',
    cost: 12.5,
    active: true,
    empty: '  ',
    nested: { a: 1 },
    nothing: null,
  });
  assert(normalized.team === 'platform', 'normalizeAllocationTags trims values');
  assert(
    normalized.cost === '12.5' && normalized.active === 'true',
    'normalizeAllocationTags coerces scalar values to strings',
  );
  assert(
    !('empty' in normalized) &&
      !('nested' in normalized) &&
      !('nothing' in normalized),
    'normalizeAllocationTags drops empty, object, and null values',
  );

  const migrator = migratorClient();
  await migrator.connect();
  const slug = `cost-alloc-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Cost Allocation Verify', slug],
  );
  const {
    rows: [cred],
  } = await migrator.query(
    `INSERT INTO cloud_credentials (tenant_id, provider, label, config_encrypted, is_enabled)
     VALUES ($1, 'aws', 'alloc-verify', pgp_sym_encrypt('{}', 'k'), true) RETURNING id`,
    [tenant.id],
  );

  const today = new Date().toISOString().slice(0, 10);
  const seed = async (
    service: string,
    amount: number,
    tags: Record<string, string>,
  ) => {
    await migrator.query(
      `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount, currency, tags)
       VALUES ($1, $2, $3, 'us-east-1', $4, $5, 'USD', $6)`,
      [tenant.id, cred.id, service, today, amount, JSON.stringify(tags)],
    );
  };

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const allocation = app.get(CostAllocationService);

  try {
    await seed('EC2', 100, { team: 'platform', environment: 'prod' });
    await seed('S3', 40, { team: 'platform', environment: 'staging' });
    await seed('RDS', 60, { team: 'data', environment: 'prod' });
    await seed('Lambda', 25, {}); // untagged

    const keys = await allocation.tagKeys(tenant.id);
    assert(
      JSON.stringify(keys) === JSON.stringify(['environment', 'team']),
      'tagKeys returns the sorted distinct set of tag keys',
    );

    const byTeam = await allocation.allocationByTag(tenant.id, 'team');
    assert(byTeam.total === 225, 'allocationByTag total reconciles with all spend');
    const platform = byTeam.rows.find((r) => r.tagValue === 'platform');
    const data = byTeam.rows.find((r) => r.tagValue === 'data');
    const untagged = byTeam.rows.find((r) => r.tagValue === '(untagged)');
    assert(platform?.amount === 140, "team 'platform' sums EC2 + S3 (140)");
    assert(data?.amount === 60, "team 'data' sums RDS (60)");
    assert(
      untagged?.amount === 25,
      'line items without the key fall into the (untagged) bucket',
    );
    assert(
      byTeam.rows[0].tagValue === 'platform',
      'rows are ordered by spend, highest first',
    );

    console.log('\nAll cost allocation checks passed.');
  } finally {
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
