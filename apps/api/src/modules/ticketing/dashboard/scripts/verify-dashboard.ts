import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { TicketsService } from '../../tickets.service';
import { DashboardService } from '../dashboard.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Dashboard verification FAILED: ${message}`);
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

  const slug = `dashboard-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Dashboard Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Test Contact', 'test@example.com'],
  );
  const {
    rows: [slaPolicyBreach],
  } = await migrator.query(
    `INSERT INTO sla_policies (tenant_id, name, first_response_target_minutes, resolution_target_minutes) VALUES ($1, $2, 0, 0) RETURNING id`,
    [tenant.id, 'Immediate SLA'],
  );
  const {
    rows: [ticketTypeBreach],
  } = await migrator.query(
    `INSERT INTO ticket_types (tenant_id, name, default_sla_policy_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Immediate type', slaPolicyBreach.id],
  );
  const {
    rows: [slaPolicyMet],
  } = await migrator.query(
    `INSERT INTO sla_policies (tenant_id, name, first_response_target_minutes, resolution_target_minutes) VALUES ($1, $2, 60, 480) RETURNING id`,
    [tenant.id, 'Comfortable SLA'],
  );
  const {
    rows: [ticketTypeMet],
  } = await migrator.query(
    `INSERT INTO ticket_types (tenant_id, name, default_sla_policy_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Comfortable type', slaPolicyMet.id],
  );
  const {
    rows: [agentUser],
  } = await migrator.query(
    `INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES ($1, $2, $3, 'x', 'agent') RETURNING id`,
    [tenant.id, 'dash-agent@example.com', 'Dash Agent'],
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
  const dashboard = app.get(DashboardService);

  try {
    // Ticket A: open, high priority, assigned, no SLA -- counted in byStatus/byPriority, not overdue.
    await ticketsService.create(tenant.id, {
      subject: 'Ticket A',
      contactId: contact.id,
      agentId: agent.id,
      priority: 'high',
      source: 'api',
    });

    // Ticket B: overdue for both first response and resolution, unassigned.
    await ticketsService.create(tenant.id, {
      subject: 'Ticket B',
      contactId: contact.id,
      ticketTypeId: ticketTypeBreach.id,
      source: 'api',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Ticket C: comfortable SLA targets, responded to and resolved well within both -- met SLA.
    const ticketC = await ticketsService.create(tenant.id, {
      subject: 'Ticket C',
      contactId: contact.id,
      ticketTypeId: ticketTypeMet.id,
      agentId: agent.id,
      source: 'api',
    });
    await ticketsService.addMessage(tenant.id, ticketC.id, {
      type: 'reply',
      authorType: 'agent',
      authorId: agent.id,
      body: 'responded',
    });
    await migrator.query(
      `UPDATE tickets SET status = 'resolved', resolved_at = created_at WHERE id = $1`,
      [ticketC.id],
    );

    const summary = await dashboard.summary(tenant.id);
    assert(
      summary.byStatus.new === 2,
      `byStatus.new counts unresolved tickets (got ${summary.byStatus.new})`,
    );
    assert(
      summary.byStatus.resolved === 1,
      `byStatus.resolved counts the resolved ticket (got ${summary.byStatus.resolved})`,
    );
    assert(
      summary.byPriority.high === 1,
      `byPriority.high counts ticket A (got ${summary.byPriority.high})`,
    );
    assert(
      summary.overdueFirstResponse === 1,
      `overdueFirstResponse counts only ticket B (got ${summary.overdueFirstResponse})`,
    );
    assert(
      summary.overdueResolution === 1,
      `overdueResolution counts only ticket B (got ${summary.overdueResolution})`,
    );
    assert(
      summary.totalOpen === 2,
      `totalOpen excludes the resolved ticket (got ${summary.totalOpen})`,
    );
    assert(
      summary.unassigned === 1,
      `unassigned counts only ticket B (got ${summary.unassigned})`,
    );

    const trends = await dashboard.trends(tenant.id, 7);
    assert(
      trends.length === 7,
      `trends returns exactly 7 days (got ${trends.length})`,
    );
    const totalCreatedInTrends = trends.reduce((sum, d) => sum + d.created, 0);
    assert(
      totalCreatedInTrends === 3,
      `trends' created counts sum to all 3 tickets created today (got ${totalCreatedInTrends})`,
    );
    const totalResolvedInTrends = trends.reduce(
      (sum, d) => sum + d.resolved,
      0,
    );
    assert(
      totalResolvedInTrends === 1,
      `trends' resolved counts sum to the 1 resolved ticket (got ${totalResolvedInTrends})`,
    );
    assert(
      trends[6].date === new Date().toISOString().slice(0, 10),
      'the last entry in trends is today',
    );

    const slaSummary = await dashboard.slaSummary(tenant.id);
    assert(
      slaSummary.totalWithSla === 2,
      `totalWithSla counts only tickets B and C (got ${slaSummary.totalWithSla})`,
    );
    assert(
      slaSummary.firstResponse.met === 1,
      `firstResponse.met counts ticket C, responded to well within target (got ${slaSummary.firstResponse.met})`,
    );
    assert(
      slaSummary.firstResponse.breached === 1,
      `firstResponse.breached counts ticket B (got ${slaSummary.firstResponse.breached})`,
    );
    assert(
      slaSummary.resolution.met === 1,
      `resolution.met counts ticket C, resolved before its due date (got ${slaSummary.resolution.met})`,
    );
    assert(
      slaSummary.resolution.breached === 1,
      `resolution.breached counts ticket B (got ${slaSummary.resolution.breached})`,
    );

    const needsAttention = await dashboard.needsAttention(tenant.id);
    assert(
      needsAttention.items.some(
        (i) => i.id === 'overdue_first_response' && i.count === 1,
      ),
      'needsAttention flags the overdue-first-response ticket',
    );
    assert(
      needsAttention.items.some(
        (i) => i.id === 'overdue_resolution' && i.count === 1,
      ),
      'needsAttention flags the overdue-resolution ticket',
    );
    assert(
      needsAttention.items.some(
        (i) => i.id === 'unassigned_tickets' && i.count === 1,
      ),
      'needsAttention flags the unassigned open ticket (ticket B)',
    );
    assert(
      needsAttention.items.every(
        (i) => i.severity === 'critical' || i.severity === 'warning',
      ),
      'every needsAttention item has a valid severity',
    );

    console.log('\nAll dashboard checks passed.');
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
