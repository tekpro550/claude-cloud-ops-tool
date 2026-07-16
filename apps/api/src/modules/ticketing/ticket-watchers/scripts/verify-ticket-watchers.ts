import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { TicketsService } from '../../tickets.service';
import { TicketWatchersService } from '../ticket-watchers.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Ticket watchers verification FAILED: ${message}`);
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
  const slug = `watchers-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Watchers Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Watch Contact', 'watch-contact@example.com'],
  );
  const mkAgent = async (name: string, email: string) => {
    const {
      rows: [user],
    } = await migrator.query(
      `INSERT INTO users (tenant_id, email, name, password_hash, role)
       VALUES ($1, $2, $3, 'x', 'agent') RETURNING id`,
      [tenant.id, email, name],
    );
    const {
      rows: [agent],
    } = await migrator.query(
      `INSERT INTO agents (tenant_id, user_id) VALUES ($1, $2) RETURNING id`,
      [tenant.id, user.id],
    );
    return agent.id as string;
  };
  const watcherAgentId = await mkAgent('Wendy Watcher', 'wendy@example.com');
  const authorAgentId = await mkAgent('Andy Author', 'andy@example.com');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const tickets = app.get(TicketsService);
  const watchers = app.get(TicketWatchersService);

  const notifCount = async (email: string) => {
    const {
      rows: [row],
    } = await migrator.query(
      `SELECT count(*)::int AS c FROM notifications
       WHERE tenant_id = $1 AND recipient = $2 AND template_name = 'ticket.watcher_update'`,
      [tenant.id, email],
    );
    return row.c as number;
  };

  try {
    const ticket = await tickets.create(tenant.id, {
      subject: 'Watched ticket',
      contactId: contact.id,
      source: 'web_form',
    });

    const afterWatch = await watchers.watch(tenant.id, ticket.id, watcherAgentId);
    assert(afterWatch.length === 1, 'watch() adds the agent as a watcher');
    // Idempotent.
    const again = await watchers.watch(tenant.id, ticket.id, watcherAgentId);
    assert(again.length === 1, 'watching twice is a no-op');
    await watchers.watch(tenant.id, ticket.id, authorAgentId);

    // A contact reply notifies both watchers.
    await tickets.addMessage(tenant.id, ticket.id, {
      type: 'reply',
      authorType: 'contact',
      body: 'Customer says hello.',
    });
    assert(
      (await notifCount('wendy@example.com')) === 1,
      'a contact reply notifies a watcher',
    );

    // An agent reply by the author does NOT notify the author (even though he
    // also watches), but does notify the other watcher. Andy already has 1
    // notification from the contact reply above, so his count must stay at 1.
    const andyBefore = await notifCount('andy@example.com');
    await tickets.addMessage(tenant.id, ticket.id, {
      type: 'reply',
      authorType: 'agent',
      authorId: authorAgentId,
      body: 'Agent reply.',
    });
    assert(
      (await notifCount('andy@example.com')) === andyBefore,
      'the agent who authored the reply is not notified of his own reply',
    );
    assert(
      (await notifCount('wendy@example.com')) === 2,
      'the other watcher is notified of the agent reply',
    );

    // A private note notifies nobody.
    await tickets.addMessage(tenant.id, ticket.id, {
      type: 'note',
      authorType: 'agent',
      authorId: authorAgentId,
      body: 'Private note.',
    });
    assert(
      (await notifCount('wendy@example.com')) === 2,
      'a private note does not notify watchers',
    );

    const afterUnwatch = await watchers.unwatch(tenant.id, ticket.id, watcherAgentId);
    assert(
      !afterUnwatch.some((w) => w.agentId === watcherAgentId),
      'unwatch() removes the watcher',
    );

    console.log('\nAll ticket watchers checks passed.');
  } finally {
    await migrator.query(`DELETE FROM notifications WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM ticket_watchers WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM ticket_messages WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM ticket_activities WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM tickets WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM ticket_number_counters WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM agents WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM users WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM contacts WHERE tenant_id = $1`, [tenant.id]);
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
