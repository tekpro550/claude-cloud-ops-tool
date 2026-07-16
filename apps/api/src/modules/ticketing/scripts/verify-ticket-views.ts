import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { TicketViewsService } from '../ticket-views.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Ticket views verification FAILED: ${message}`);
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

  const slug = `ticket-views-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Ticket Views Verify', slug],
  );

  const makeAgent = async (name: string) => {
    const {
      rows: [user],
    } = await migrator.query(
      `INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES ($1, $2, $3, 'x', 'agent') RETURNING id`,
      [tenant.id, `${name.toLowerCase()}@example.com`, name],
    );
    const {
      rows: [agent],
    } = await migrator.query(
      `INSERT INTO agents (tenant_id, user_id) VALUES ($1, $2) RETURNING id`,
      [tenant.id, user.id],
    );
    return agent.id as string;
  };

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const ticketViews = app.get(TicketViewsService);

  try {
    const agentA = await makeAgent('Agent A');
    const agentB = await makeAgent('Agent B');

    const shared = await ticketViews.create(tenant.id, undefined, {
      name: 'Escalated this week',
      filters: { priority: 'urgent' },
    });
    assert(
      shared.agent_id === null,
      'a view created with no resolved agent id is saved as a shared/team view',
    );

    const personal = await ticketViews.create(tenant.id, agentA, {
      name: "Agent A's queue",
      filters: { agentId: agentA, unassigned: false },
    });
    assert(
      personal.agent_id === agentA,
      "a view created by agent A is saved as agent A's personal view",
    );

    const listForA = await ticketViews.list(tenant.id, agentA);
    assert(
      listForA.length === 2,
      `agent A sees both the shared view and their own personal view (got ${listForA.length})`,
    );

    const listForB = await ticketViews.list(tenant.id, agentB);
    assert(
      listForB.length === 1 && listForB[0].id === shared.id,
      'agent B, who owns no personal views, sees only the shared view (got ' +
        listForB.length +
        ')',
    );

    const renamed = await ticketViews.update(tenant.id, personal.id, {
      name: 'Renamed view',
    });
    assert(
      renamed.name === 'Renamed view',
      'update() renames a view without touching its filters',
    );
    assert(
      JSON.stringify(renamed.filters) === JSON.stringify(personal.filters),
      "update()'s partial rename left filters untouched",
    );

    await ticketViews.remove(tenant.id, personal.id);
    const listAfterDelete = await ticketViews.list(tenant.id, agentA);
    assert(
      listAfterDelete.length === 1,
      'remove() deletes the view (agent A now sees only the shared view)',
    );

    let notFound: any = null;
    try {
      await ticketViews.remove(tenant.id, personal.id);
    } catch (err) {
      notFound = err;
    }
    assert(
      notFound?.status === 404,
      'removing an already-deleted view returns 404',
    );

    console.log('\nAll ticket views checks passed.');
  } finally {
    await migrator.query(`DELETE FROM ticket_views WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM agents WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM users WHERE tenant_id = $1`, [tenant.id]);
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
