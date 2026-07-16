import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { TicketPresenceService } from '../ticket-presence.service';
import { TicketsService } from '../tickets.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Ticket presence verification FAILED: ${message}`);
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

  const slug = `ticket-presence-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Ticket Presence Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Test Contact', 'test@example.com'],
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
  const ticketsService = app.get(TicketsService);
  const presence = app.get(TicketPresenceService);

  try {
    const agentA = await makeAgent('Agent A');
    const agentB = await makeAgent('Agent B');
    const ticket = await ticketsService.create(tenant.id, {
      subject: 'Presence test ticket',
      contactId: contact.id,
      source: 'api',
    });

    await presence.heartbeat(tenant.id, ticket.id, agentA, false);

    const listForB = await presence.list(tenant.id, ticket.id, agentB);
    assert(
      listForB.length === 1 && listForB[0].agent_id === agentA,
      "listing presence excluding agent B shows agent A's heartbeat",
    );
    assert(
      listForB[0].is_typing === false,
      "agent A's presence row correctly reports is_typing=false",
    );

    const listForA = await presence.list(tenant.id, ticket.id, agentA);
    assert(
      listForA.length === 0,
      "listing presence excluding agent A never shows agent A's own heartbeat",
    );

    await presence.heartbeat(tenant.id, ticket.id, agentB, true);
    const listForANow = await presence.list(tenant.id, ticket.id, agentA);
    assert(
      listForANow.length === 1 &&
        listForANow[0].agent_id === agentB &&
        listForANow[0].is_typing === true,
      "agent B's typing heartbeat shows up for agent A, with is_typing=true",
    );

    // Age agent A's row out of the TTL window and confirm it's filtered.
    await migrator.query(
      `UPDATE ticket_presence SET last_seen_at = now() - interval '60 seconds' WHERE ticket_id = $1 AND agent_id = $2`,
      [ticket.id, agentA],
    );
    const listAfterStale = await presence.list(tenant.id, ticket.id, agentB);
    assert(
      listAfterStale.length === 0,
      'a stale (>20s old) presence row ages out and is no longer shown',
    );

    console.log('\nAll ticket presence checks passed.');
  } finally {
    await migrator.query(`DELETE FROM ticket_presence WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM tickets WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(
      `DELETE FROM ticket_number_counters WHERE tenant_id = $1`,
      [tenant.id],
    );
    await migrator.query(`DELETE FROM agents WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM users WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM contacts WHERE tenant_id = $1`, [
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
