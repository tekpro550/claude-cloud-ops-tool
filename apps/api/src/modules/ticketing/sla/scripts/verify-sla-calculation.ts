import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { TicketsService } from '../../tickets.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`SLA calculation verification FAILED: ${message}`);
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

const MINUTE_MS = 60_000;

async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `sla-calc-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['SLA Calc Verify', slug],
  );

  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Test Contact', 'test@example.com'],
  );

  const {
    rows: [slaPolicy],
  } = await migrator.query(
    `INSERT INTO sla_policies (tenant_id, name, first_response_target_minutes, resolution_target_minutes) VALUES ($1, $2, 60, 480) RETURNING id`,
    [tenant.id, 'Standard SLA'],
  );

  const {
    rows: [ticketTypeWithSla],
  } = await migrator.query(
    `INSERT INTO ticket_types (tenant_id, name, default_sla_policy_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Cloud Support - Azure', slaPolicy.id],
  );

  const {
    rows: [ticketTypeWithoutSla],
  } = await migrator.query(
    `INSERT INTO ticket_types (tenant_id, name) VALUES ($1, $2) RETURNING id`,
    [tenant.id, 'General'],
  );

  const {
    rows: [agentUser],
  } = await migrator.query(
    `INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES ($1, $2, $3, 'x', 'agent') RETURNING id`,
    [tenant.id, 'agent@example.com', 'Test Agent'],
  );
  const {
    rows: [agent],
  } = await migrator.query(
    `INSERT INTO agents (tenant_id, user_id) VALUES ($1, $2) RETURNING id`,
    [tenant.id, agentUser.id],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const ticketsService = app.get(TicketsService);

  try {
    const ticketWithSla = await ticketsService.create(tenant.id, {
      subject: 'Ticket with an SLA policy',
      contactId: contact.id,
      ticketTypeId: ticketTypeWithSla.id,
      source: 'api',
    });
    assert(
      ticketWithSla.sla_policy_id === slaPolicy.id,
      'ticket created via a ticket_type with a default SLA policy inherits it',
    );

    const createdAt = new Date(ticketWithSla.created_at).getTime();
    const firstResponseDueAt = new Date(
      ticketWithSla.first_response_due_at,
    ).getTime();
    const resolutionDueAt = new Date(ticketWithSla.resolution_due_at).getTime();
    assert(
      Math.abs(firstResponseDueAt - (createdAt + 60 * MINUTE_MS)) < 1000,
      'first_response_due_at = created_at + first_response_target_minutes',
    );
    assert(
      Math.abs(resolutionDueAt - (createdAt + 480 * MINUTE_MS)) < 1000,
      'resolution_due_at = created_at + resolution_target_minutes',
    );

    const ticketWithoutSla = await ticketsService.create(tenant.id, {
      subject: 'Ticket with no SLA policy',
      contactId: contact.id,
      ticketTypeId: ticketTypeWithoutSla.id,
      source: 'api',
    });
    assert(
      ticketWithoutSla.sla_policy_id === null,
      'ticket via a ticket_type with no default SLA policy has none',
    );
    assert(
      ticketWithoutSla.first_response_due_at === null &&
        ticketWithoutSla.resolution_due_at === null,
      'due dates are null when there is no applicable SLA policy',
    );

    const originalCreatedAt = new Date(ticketWithoutSla.created_at).getTime();
    const updated = await ticketsService.update(
      tenant.id,
      ticketWithoutSla.id,
      { ticketTypeId: ticketTypeWithSla.id },
    );
    assert(
      updated.sla_policy_id === slaPolicy.id,
      'changing ticket_type_id to one with an SLA policy applies it retroactively',
    );
    const updatedFirstResponseDueAt = new Date(
      updated.first_response_due_at,
    ).getTime();
    assert(
      Math.abs(
        updatedFirstResponseDueAt - (originalCreatedAt + 60 * MINUTE_MS),
      ) < 1000,
      "recalculated due date is anchored to the ticket's original created_at, not the moment of the update",
    );

    await ticketsService.addMessage(tenant.id, ticketWithSla.id, {
      type: 'note',
      authorType: 'system',
      body: 'internal note, should not count as first response',
    });
    let refetched = await ticketsService.get(tenant.id, ticketWithSla.id);
    assert(
      refetched.first_response_at === null,
      'a system note does not set first_response_at',
    );

    await ticketsService.addMessage(tenant.id, ticketWithSla.id, {
      type: 'reply',
      authorType: 'contact',
      authorId: contact.id,
      body: "the customer's own message should not count as first response either",
    });
    refetched = await ticketsService.get(tenant.id, ticketWithSla.id);
    assert(
      refetched.first_response_at === null,
      'a contact reply does not set first_response_at',
    );

    await ticketsService.addMessage(tenant.id, ticketWithSla.id, {
      type: 'reply',
      authorType: 'agent',
      authorId: agent.id,
      body: 'Thanks for reaching out, looking into it now.',
    });
    refetched = await ticketsService.get(tenant.id, ticketWithSla.id);
    assert(
      refetched.first_response_at !== null,
      'the first agent reply sets first_response_at',
    );
    const firstResponseAt = refetched.first_response_at;

    await new Promise((resolve) => setTimeout(resolve, 50));
    await ticketsService.addMessage(tenant.id, ticketWithSla.id, {
      type: 'reply',
      authorType: 'agent',
      authorId: agent.id,
      body: 'A follow-up reply.',
    });
    refetched = await ticketsService.get(tenant.id, ticketWithSla.id);
    assert(
      new Date(refetched.first_response_at).getTime() ===
        new Date(firstResponseAt).getTime(),
      'a second agent reply does not overwrite the already-recorded first_response_at',
    );

    console.log('\nAll SLA calculation checks passed.');
  } finally {
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
    await migrator.query(`DELETE FROM ticket_types WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM sla_policies WHERE tenant_id = $1`, [
      tenant.id,
    ]);
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
