import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { TicketsService } from '../tickets.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Outbound reply verification FAILED: ${message}`);
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

async function waitForNotification(
  migrator: Client,
  tenantId: string,
  recipient: string,
  timeoutMs = 10000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await migrator.query(
      `SELECT status, template_name, payload FROM notifications
       WHERE tenant_id = $1 AND recipient = $2 AND template_name = 'ticket.reply'
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId, recipient],
    );
    if (rows[0] && rows[0].status !== 'queued') return rows[0];
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `timed out waiting for a ticket.reply notification to ${recipient}`,
  );
}

async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `outbound-reply-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Outbound Reply Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id, email`,
    [tenant.id, 'Casey Contact', 'casey@customer.example'],
  );
  const {
    rows: [user],
  } = await migrator.query(
    `INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES ($1, $2, $3, 'x', 'agent') RETURNING id`,
    [tenant.id, 'aria@agent.example', 'Aria Agent'],
  );
  const {
    rows: [agent],
  } = await migrator.query(
    `INSERT INTO agents (tenant_id, user_id) VALUES ($1, $2) RETURNING id`,
    [tenant.id, user.id],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const tickets = app.get(TicketsService);

  try {
    const ticket = await tickets.create(tenant.id, {
      subject: 'My dashboard is broken',
      contactId: contact.id,
      source: 'web_form',
    });

    // A private note must NOT email the contact.
    await tickets.addMessage(tenant.id, ticket.id, {
      type: 'note',
      authorType: 'agent',
      authorId: agent.id,
      body: 'Internal: looks like a caching bug.',
    });
    // Give any (erroneous) enqueue a moment to land before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const { rows: afterNote } = await migrator.query(
      `SELECT count(*)::int AS n FROM notifications WHERE tenant_id = $1 AND template_name = 'ticket.reply'`,
      [tenant.id],
    );
    assert(
      afterNote[0].n === 0,
      'a private note does not enqueue an outbound reply email',
    );

    // A public agent reply MUST email the contact.
    await tickets.addMessage(tenant.id, ticket.id, {
      type: 'reply',
      authorType: 'agent',
      authorId: agent.id,
      body: 'Hi Casey — we cleared the cache, please try again.',
    });

    const notification = await waitForNotification(
      migrator,
      tenant.id,
      contact.email,
    );
    assert(
      notification.status === 'sent',
      "the agent's public reply was dispatched to the contact (status=sent)",
    );
    assert(
      notification.template_name === 'ticket.reply',
      'the notification uses the ticket.reply template',
    );
    assert(
      Number(notification.payload.ticketNumber) === ticket.ticket_number,
      'the payload carries the ticket number for the [Ticket #N] subject tag (got #' +
        notification.payload.ticketNumber +
        ')',
    );
    assert(
      notification.payload.agentName === 'Aria Agent',
      "the reply is attributed to the replying agent's name",
    );

    // A contact-authored message (e.g. from email intake) must NOT loop back
    // out to the contact as an email.
    await tickets.addMessage(tenant.id, ticket.id, {
      type: 'reply',
      authorType: 'contact',
      authorId: contact.id,
      body: 'Thanks, it works now!',
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const { rows: replyCount } = await migrator.query(
      `SELECT count(*)::int AS n FROM notifications WHERE tenant_id = $1 AND template_name = 'ticket.reply'`,
      [tenant.id],
    );
    assert(
      replyCount[0].n === 1,
      "a contact's own reply does not generate an outbound email (still exactly 1)",
    );

    console.log('\nAll outbound reply checks passed.');
  } finally {
    await migrator.query(`DELETE FROM notifications WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM ticket_messages WHERE tenant_id = $1`, [
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
