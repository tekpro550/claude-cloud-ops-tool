import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { TicketsService } from '../tickets.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Agent notifications verification FAILED: ${message}`);
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

async function waitFor(
  migrator: Client,
  tenantId: string,
  template: string,
  recipient: string,
  timeoutMs = 10000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await migrator.query(
      `SELECT status FROM notifications WHERE tenant_id = $1 AND template_name = $2 AND recipient = $3 ORDER BY created_at DESC LIMIT 1`,
      [tenantId, template, recipient],
    );
    if (rows[0] && rows[0].status !== 'queued') return rows[0];
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out waiting for ${template} to ${recipient}`);
}

async function main() {
  const migrator = migratorClient();
  await migrator.connect();
  const slug = `agent-notify-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Agent Notify Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Nora Contact', 'nora@example.com'],
  );
  const {
    rows: [user],
  } = await migrator.query(
    `INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES ($1, $2, $3, 'x', 'agent') RETURNING id`,
    [tenant.id, 'gus@agent.example', 'Gus Agent'],
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
      subject: 'Notify me',
      contactId: contact.id,
      source: 'web_form',
    });

    // Assigning the ticket to Gus emails Gus.
    await tickets.update(tenant.id, ticket.id, { agentId: agent.id });
    const assigned = await waitFor(
      migrator,
      tenant.id,
      'ticket.assigned',
      'gus@agent.example',
    );
    assert(
      assigned.status === 'sent',
      'assigning a ticket emails the newly-assigned agent (status=sent)',
    );

    // Re-applying the same agent does NOT re-notify.
    const before = (
      await migrator.query(
        `SELECT count(*)::int AS n FROM notifications WHERE tenant_id = $1 AND template_name = 'ticket.assigned'`,
        [tenant.id],
      )
    ).rows[0].n;
    await tickets.update(tenant.id, ticket.id, { agentId: agent.id });
    await new Promise((r) => setTimeout(r, 400));
    const after = (
      await migrator.query(
        `SELECT count(*)::int AS n FROM notifications WHERE tenant_id = $1 AND template_name = 'ticket.assigned'`,
        [tenant.id],
      )
    ).rows[0].n;
    assert(
      before === after,
      're-assigning to the same agent does not send a duplicate assignment email',
    );

    // A contact reply on the assigned ticket emails the agent.
    await tickets.addMessage(tenant.id, ticket.id, {
      type: 'reply',
      authorType: 'contact',
      authorId: contact.id,
      body: 'Any update on this?',
    });
    const replyNotify = await waitFor(
      migrator,
      tenant.id,
      'ticket.contact_reply',
      'gus@agent.example',
    );
    assert(
      replyNotify.status === 'sent',
      "a customer reply emails the ticket's assigned agent (status=sent)",
    );

    console.log('\nAll agent notification checks passed.');
  } finally {
    for (const t of [
      'notifications',
      'ticket_messages',
      'tickets',
      'ticket_number_counters',
      'agents',
      'users',
      'contacts',
    ]) {
      await migrator.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [
        tenant.id,
      ]);
    }
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
