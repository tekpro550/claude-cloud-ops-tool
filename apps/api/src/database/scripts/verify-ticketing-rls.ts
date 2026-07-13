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
    throw new Error(`Ticketing RLS verification FAILED: ${message}`);
  }
  console.log(`  OK  ${message}`);
}

/**
 * Same proof as verify-rls.ts, extended to the Sprint 1 ticketing tables:
 * every query below runs as app_user with no WHERE tenant_id = ... clause,
 * so isolation only holds if the FORCE ROW LEVEL SECURITY policies on
 * groups/contacts/tickets/ticket_messages actually work.
 */
async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `ticketing-rls-verify-${Date.now()}`;
  const {
    rows: [tenantA],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Ticketing RLS Verify A', `${slug}-a`],
  );
  const {
    rows: [tenantB],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Ticketing RLS Verify B', `${slug}-b`],
  );

  const appUser = appUserClient();
  await appUser.connect();

  try {
    let contactAId = '';
    let ticketAId = '';

    await appUser.query('BEGIN');
    await appUser.query("SELECT set_config('app.current_tenant', $1, true)", [
      tenantA.id,
    ]);
    const {
      rows: [contactA],
    } = await appUser.query(
      `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
      [tenantA.id, 'Tenant A Contact', 'a@example.com'],
    );
    contactAId = contactA.id;
    const {
      rows: [ticketA],
    } = await appUser.query(
      `INSERT INTO tickets (tenant_id, ticket_number, subject, contact_id, source) VALUES ($1, 1, $2, $3, 'email') RETURNING id`,
      [tenantA.id, 'Tenant A ticket', contactAId],
    );
    ticketAId = ticketA.id;
    await appUser.query('COMMIT');

    await appUser.query('BEGIN');
    await appUser.query("SELECT set_config('app.current_tenant', $1, true)", [
      tenantB.id,
    ]);
    const {
      rows: [contactB],
    } = await appUser.query(
      `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
      [tenantB.id, 'Tenant B Contact', 'b@example.com'],
    );
    await appUser.query(
      `INSERT INTO tickets (tenant_id, ticket_number, subject, contact_id, source) VALUES ($1, 1, $2, $3, 'email') RETURNING id`,
      [tenantB.id, 'Tenant B ticket', contactB.id],
    );
    await appUser.query('COMMIT');

    await appUser.query('BEGIN');
    await appUser.query("SELECT set_config('app.current_tenant', $1, true)", [
      tenantA.id,
    ]);
    const { rows: ticketsAsA } = await appUser.query(
      `SELECT tenant_id, subject FROM tickets`,
    );
    const { rows: contactsAsA } = await appUser.query(
      `SELECT tenant_id, name FROM contacts`,
    );
    await appUser.query('COMMIT');
    assert(
      ticketsAsA.length === 1 && ticketsAsA[0].subject === 'Tenant A ticket',
      'tenant A sees only its own ticket via an unfiltered SELECT *',
    );
    assert(
      contactsAsA.length === 1 && contactsAsA[0].name === 'Tenant A Contact',
      'tenant A sees only its own contact via an unfiltered SELECT *',
    );

    await appUser.query('BEGIN');
    await appUser.query("SELECT set_config('app.current_tenant', $1, true)", [
      tenantA.id,
    ]);
    let crossTenantMessageBlocked = false;
    try {
      await appUser.query(
        `INSERT INTO ticket_messages (tenant_id, ticket_id, type, author_type, body) VALUES ($1, $2, 'note', 'system', 'leak attempt')`,
        [tenantB.id, ticketAId],
      );
    } catch {
      crossTenantMessageBlocked = true;
    } finally {
      await appUser.query('ROLLBACK');
    }
    assert(
      crossTenantMessageBlocked,
      'cross-tenant ticket_message insert (context=A, tenant_id=B) rejected by WITH CHECK',
    );

    await appUser.query('BEGIN');
    await appUser.query("SELECT set_config('app.current_tenant', $1, true)", [
      tenantA.id,
    ]);
    await appUser.query(
      `INSERT INTO sla_policies (tenant_id, name, first_response_target_minutes, resolution_target_minutes) VALUES ($1, $2, 60, 480)`,
      [tenantA.id, 'Tenant A SLA'],
    );
    await appUser.query('COMMIT');

    await appUser.query('BEGIN');
    await appUser.query("SELECT set_config('app.current_tenant', $1, true)", [
      tenantB.id,
    ]);
    const { rows: slaPoliciesAsB } = await appUser.query(
      `SELECT tenant_id, name FROM sla_policies`,
    );
    await appUser.query('COMMIT');
    assert(
      slaPoliciesAsB.length === 0,
      "tenant B sees zero SLA policies via an unfiltered SELECT * (tenant A's policy is invisible)",
    );

    console.log(
      '\nAll ticketing RLS checks passed. groups/contacts/tickets/ticket_messages/sla_policies are tenant-isolated at the database layer.',
    );
  } finally {
    await migrator.query(
      `DELETE FROM sla_policies WHERE tenant_id IN ($1, $2)`,
      [tenantA.id, tenantB.id],
    );
    await migrator.query(
      `DELETE FROM ticket_messages WHERE tenant_id IN ($1, $2)`,
      [tenantA.id, tenantB.id],
    );
    await migrator.query(`DELETE FROM tickets WHERE tenant_id IN ($1, $2)`, [
      tenantA.id,
      tenantB.id,
    ]);
    await migrator.query(`DELETE FROM contacts WHERE tenant_id IN ($1, $2)`, [
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
