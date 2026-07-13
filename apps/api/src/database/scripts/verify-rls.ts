import { Client } from 'pg';

const DB_HOST = process.env.DB_HOST ?? 'localhost';
const DB_PORT = Number(process.env.DB_PORT ?? 5432);
const DB_NAME = process.env.DB_NAME ?? 'cloud_ops_tool';

function migratorClient() {
  return new Client({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: process.env.DB_MIGRATOR_USER ?? 'postgres',
    password: process.env.DB_MIGRATOR_PASSWORD ?? 'postgres',
  });
}

function appUserClient() {
  return new Client({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: process.env.DB_APP_USER ?? 'app_user',
    password: process.env.DB_APP_PASSWORD ?? 'app_user_dev_password',
  });
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`RLS verification FAILED: ${message}`);
  }
  console.log(`  OK  ${message}`);
}

/**
 * Proves RLS is enforced by Postgres itself, not by application code: every
 * query below runs as app_user (the same role the NestJS app connects as)
 * and never adds a WHERE tenant_id = ... clause. If isolation held only
 * because application code remembered to filter, this script would leak
 * rows across tenants the moment that discipline lapsed.
 */
async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `rls-verify-${Date.now()}`;
  const {
    rows: [tenantA],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['RLS Verify A', `${slug}-a`],
  );
  const {
    rows: [tenantB],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['RLS Verify B', `${slug}-b`],
  );

  const appUser = appUserClient();
  await appUser.connect();

  try {
    await appUser.query('BEGIN');
    await appUser.query("SELECT set_config('app.current_tenant', $1, true)", [
      tenantA.id,
    ]);
    await appUser.query(
      `INSERT INTO resources (tenant_id, name, resource_type) VALUES ($1, $2, 'server')`,
      [tenantA.id, 'tenant-a-server'],
    );
    await appUser.query('COMMIT');

    await appUser.query('BEGIN');
    await appUser.query("SELECT set_config('app.current_tenant', $1, true)", [
      tenantB.id,
    ]);
    await appUser.query(
      `INSERT INTO resources (tenant_id, name, resource_type) VALUES ($1, $2, 'server')`,
      [tenantB.id, 'tenant-b-server'],
    );
    await appUser.query('COMMIT');

    await appUser.query('BEGIN');
    await appUser.query("SELECT set_config('app.current_tenant', $1, true)", [
      tenantA.id,
    ]);
    const { rows: asTenantA } = await appUser.query(
      `SELECT tenant_id, name FROM resources`,
    );
    await appUser.query('COMMIT');
    assert(
      asTenantA.length === 1 && asTenantA[0].name === 'tenant-a-server',
      'tenant A session sees only its own resource via an unfiltered SELECT *',
    );

    await appUser.query('BEGIN');
    await appUser.query("SELECT set_config('app.current_tenant', $1, true)", [
      tenantB.id,
    ]);
    const { rows: asTenantB } = await appUser.query(
      `SELECT tenant_id, name FROM resources`,
    );
    await appUser.query('COMMIT');
    assert(
      asTenantB.length === 1 && asTenantB[0].name === 'tenant-b-server',
      'tenant B session sees only its own resource via an unfiltered SELECT *',
    );

    await appUser.query('BEGIN');
    await appUser.query("SELECT set_config('app.current_tenant', $1, true)", [
      tenantA.id,
    ]);
    let crossTenantInsertBlocked = false;
    try {
      await appUser.query(
        `INSERT INTO resources (tenant_id, name, resource_type) VALUES ($1, $2, 'server')`,
        [tenantB.id, 'cross-tenant-attempt'],
      );
    } catch {
      crossTenantInsertBlocked = true;
    } finally {
      await appUser.query('ROLLBACK');
    }
    assert(
      crossTenantInsertBlocked,
      'cross-tenant insert (context=A, tenant_id=B) rejected by the WITH CHECK policy',
    );

    await appUser.query('BEGIN');
    const { rows: noContext } = await appUser.query(
      `SELECT tenant_id FROM resources`,
    );
    await appUser.query('COMMIT');
    assert(
      noContext.length === 0,
      'no app.current_tenant set -> zero rows returned (default-deny, not an error)',
    );

    console.log(
      '\nAll RLS checks passed. Tenant isolation is enforced at the database layer.',
    );
  } finally {
    await migrator.query(`DELETE FROM resources WHERE tenant_id IN ($1, $2)`, [
      tenantA.id,
      tenantB.id,
    ]);
    await migrator.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [
      tenantA.id,
      tenantB.id,
    ]);
    await appUser.end();
    await migrator.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
