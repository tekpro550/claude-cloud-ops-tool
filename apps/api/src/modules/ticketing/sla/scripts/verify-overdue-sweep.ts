import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { TicketsService } from '../../tickets.service';
import { OverdueSweepService } from '../overdue-sweep.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Overdue sweep verification FAILED: ${message}`);
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
      `SELECT status, sent_at FROM notifications WHERE tenant_id = $1 AND recipient = $2 AND template_name = 'ticket.overdue' ORDER BY created_at DESC LIMIT 1`,
      [tenantId, recipient],
    );
    if (rows[0] && rows[0].status !== 'queued') return rows[0];
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `timed out waiting for a ticket.overdue notification to ${recipient}`,
  );
}

async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `overdue-sweep-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Overdue Sweep Verify', slug],
  );

  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Test Contact', 'test@example.com'],
  );

  // first_response_target_minutes = 0 -> due_at equals created_at, so it's
  // already in the past by the time the sweep runs a moment later.
  const {
    rows: [slaFirstResponse],
  } = await migrator.query(
    `INSERT INTO sla_policies (tenant_id, name, first_response_target_minutes, resolution_target_minutes) VALUES ($1, $2, 0, 100000) RETURNING id`,
    [tenant.id, 'Immediate first response'],
  );
  const {
    rows: [slaResolution],
  } = await migrator.query(
    `INSERT INTO sla_policies (tenant_id, name, first_response_target_minutes, resolution_target_minutes) VALUES ($1, $2, 100000, 0) RETURNING id`,
    [tenant.id, 'Immediate resolution'],
  );
  const {
    rows: [slaFarFuture],
  } = await migrator.query(
    `INSERT INTO sla_policies (tenant_id, name, first_response_target_minutes, resolution_target_minutes) VALUES ($1, $2, 100000, 100000) RETURNING id`,
    [tenant.id, 'Far future'],
  );

  const {
    rows: [typeFirstResponse],
  } = await migrator.query(
    `INSERT INTO ticket_types (tenant_id, name, default_sla_policy_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Immediate first response type', slaFirstResponse.id],
  );
  const {
    rows: [typeResolution],
  } = await migrator.query(
    `INSERT INTO ticket_types (tenant_id, name, default_sla_policy_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Immediate resolution type', slaResolution.id],
  );
  const {
    rows: [typeFarFuture],
  } = await migrator.query(
    `INSERT INTO ticket_types (tenant_id, name, default_sla_policy_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Far future type', slaFarFuture.id],
  );

  const {
    rows: [agentUser],
  } = await migrator.query(
    `INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES ($1, $2, $3, 'x', 'agent') RETURNING id`,
    [tenant.id, 'overdue-agent@example.com', 'Overdue Test Agent'],
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
  const sweep = app.get(OverdueSweepService);

  try {
    const ticketFirstResponseOverdue = await ticketsService.create(tenant.id, {
      subject: 'Should become first-response overdue',
      contactId: contact.id,
      ticketTypeId: typeFirstResponse.id,
      agentId: agent.id,
      source: 'api',
    });

    const ticketResolutionOverdue = await ticketsService.create(tenant.id, {
      subject: 'Should become resolution overdue',
      contactId: contact.id,
      ticketTypeId: typeResolution.id,
      agentId: agent.id,
      source: 'api',
    });

    const ticketAlreadyResponded = await ticketsService.create(tenant.id, {
      subject: 'Already responded, must not be flagged',
      contactId: contact.id,
      ticketTypeId: typeFirstResponse.id,
      agentId: agent.id,
      source: 'api',
    });
    await ticketsService.addMessage(tenant.id, ticketAlreadyResponded.id, {
      type: 'reply',
      authorType: 'agent',
      authorId: agent.id,
      body: 'Responding before the sweep runs.',
    });

    const ticketNoAgent = await ticketsService.create(tenant.id, {
      subject: 'Overdue with no agent assigned',
      contactId: contact.id,
      ticketTypeId: typeFirstResponse.id,
      source: 'api',
    });

    const ticketNotDueYet = await ticketsService.create(tenant.id, {
      subject: 'Not due for a very long time',
      contactId: contact.id,
      ticketTypeId: typeFarFuture.id,
      agentId: agent.id,
      source: 'api',
    });

    // Let the 0-minute due dates actually fall into the past before sweeping.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const notifiedCount = await sweep.runSweepOnce();
    assert(
      notifiedCount === 3,
      `first sweep pass reports 3 breaches (got ${notifiedCount})`,
    );

    const {
      rows: [refetchedFR],
    } = await migrator.query(
      `SELECT first_response_overdue_notified_at, resolution_overdue_notified_at FROM tickets WHERE id = $1`,
      [ticketFirstResponseOverdue.id],
    );
    assert(
      refetchedFR.first_response_overdue_notified_at !== null,
      'first-response-overdue ticket got first_response_overdue_notified_at set',
    );
    assert(
      refetchedFR.resolution_overdue_notified_at === null,
      "first-response-overdue ticket's resolution flag was left untouched (target is 100000 minutes out)",
    );

    const {
      rows: [refetchedRes],
    } = await migrator.query(
      `SELECT first_response_overdue_notified_at, resolution_overdue_notified_at FROM tickets WHERE id = $1`,
      [ticketResolutionOverdue.id],
    );
    assert(
      refetchedRes.resolution_overdue_notified_at !== null,
      'resolution-overdue ticket got resolution_overdue_notified_at set',
    );

    const {
      rows: [refetchedResponded],
    } = await migrator.query(
      `SELECT first_response_overdue_notified_at FROM tickets WHERE id = $1`,
      [ticketAlreadyResponded.id],
    );
    assert(
      refetchedResponded.first_response_overdue_notified_at === null,
      'a ticket that already got its first agent reply before the sweep ran is not flagged overdue',
    );

    const {
      rows: [refetchedNoAgent],
    } = await migrator.query(
      `SELECT first_response_overdue_notified_at FROM tickets WHERE id = $1`,
      [ticketNoAgent.id],
    );
    assert(
      refetchedNoAgent.first_response_overdue_notified_at !== null,
      'an overdue ticket with no assigned agent is still flagged (event still fires, just no email recipient)',
    );

    const {
      rows: [refetchedNotDue],
    } = await migrator.query(
      `SELECT first_response_overdue_notified_at, resolution_overdue_notified_at FROM tickets WHERE id = $1`,
      [ticketNotDueYet.id],
    );
    assert(
      refetchedNotDue.first_response_overdue_notified_at === null &&
        refetchedNotDue.resolution_overdue_notified_at === null,
      "a ticket that isn't due yet is left completely untouched",
    );

    const { rows: overdueEvents } = await migrator.query(
      `SELECT payload FROM events WHERE tenant_id = $1 AND event_type = 'ticket.overdue' ORDER BY created_at ASC`,
      [tenant.id],
    );
    assert(
      overdueEvents.length === 3,
      `exactly 3 ticket.overdue events were published (got ${overdueEvents.length})`,
    );
    assert(
      overdueEvents.some(
        (e: any) =>
          e.payload.ticketId === ticketFirstResponseOverdue.id &&
          e.payload.overdueType === 'first_response',
      ),
      'a ticket.overdue event with overdueType=first_response was published for the first-response-overdue ticket',
    );
    assert(
      overdueEvents.some(
        (e: any) =>
          e.payload.ticketId === ticketResolutionOverdue.id &&
          e.payload.overdueType === 'resolution',
      ),
      'a ticket.overdue event with overdueType=resolution was published for the resolution-overdue ticket',
    );
    assert(
      overdueEvents.some((e: any) => e.payload.ticketId === ticketNoAgent.id),
      'a ticket.overdue event was published for the unassigned ticket too',
    );

    const sentNotification = await waitForNotification(
      migrator,
      tenant.id,
      'overdue-agent@example.com',
    );
    assert(
      sentNotification.status === 'sent',
      `the assigned agent's overdue email was dispatched (status=${sentNotification.status})`,
    );

    const { rows: overdueNotifications } = await migrator.query(
      `SELECT id FROM notifications WHERE tenant_id = $1 AND template_name = 'ticket.overdue'`,
      [tenant.id],
    );
    assert(
      overdueNotifications.length === 2,
      `exactly 2 ticket.overdue notifications exist -- one per assigned-agent breach, none for the unassigned ticket (got ${overdueNotifications.length})`,
    );

    const secondPassCount = await sweep.runSweepOnce();
    assert(
      secondPassCount === 0,
      `a second sweep pass finds nothing new to flag (idempotent, got ${secondPassCount})`,
    );

    const { rows: eventsAfterSecondPass } = await migrator.query(
      `SELECT id FROM events WHERE tenant_id = $1 AND event_type = 'ticket.overdue'`,
      [tenant.id],
    );
    assert(
      eventsAfterSecondPass.length === 3,
      'the second sweep pass did not publish any additional ticket.overdue events',
    );

    console.log('\nAll overdue sweep checks passed.');
  } finally {
    await migrator.query(`DELETE FROM notifications WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM events WHERE tenant_id = $1`, [
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
