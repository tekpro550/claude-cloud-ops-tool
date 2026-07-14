import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { AdminService } from '../admin.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Admin verification FAILED: ${message}`);
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

  const slug = `admin-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Admin Verify', slug],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const admin = app.get(AdminService);

  try {
    const emptyStatus = await admin.setupStatus(tenant.id);
    assert(
      emptyStatus.complete === false,
      "a brand new tenant's setup is not complete",
    );
    assert(
      emptyStatus.completedCount === 0,
      `a brand new tenant has 0 completed items (got ${emptyStatus.completedCount})`,
    );
    assert(
      emptyStatus.totalCount === 6,
      `there are 6 tracked setup items (got ${emptyStatus.totalCount})`,
    );
    assert(
      emptyStatus.items.every(
        (i: any) => i.complete === false && i.count === 0,
      ),
      'every item starts incomplete with a zero count',
    );

    await migrator.query(
      `INSERT INTO groups (tenant_id, name) VALUES ($1, $2)`,
      [tenant.id, 'Cloud Support'],
    );
    await migrator.query(
      `INSERT INTO sla_policies (tenant_id, name, first_response_target_minutes, resolution_target_minutes) VALUES ($1, $2, 60, 480)`,
      [tenant.id, 'Standard SLA'],
    );

    const partialStatus = await admin.setupStatus(tenant.id);
    assert(
      partialStatus.complete === false,
      'still incomplete with only 2 of 6 items configured',
    );
    assert(
      partialStatus.completedCount === 2,
      `2 items are now complete (got ${partialStatus.completedCount})`,
    );
    const groupsItem = partialStatus.items.find((i: any) => i.key === 'groups');
    assert(
      groupsItem?.complete === true && groupsItem?.count === 1,
      'the groups item reflects the group just created',
    );
    const agentsItem = partialStatus.items.find((i: any) => i.key === 'agents');
    assert(
      agentsItem?.complete === false,
      'the agents item is still incomplete (none created)',
    );

    console.log('\nAll admin setup-status checks passed.');
  } finally {
    await migrator.query(`DELETE FROM sla_policies WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM groups WHERE tenant_id = $1`, [
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
