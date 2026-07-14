import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { TicketsService } from '../tickets.service';
import { TicketTimeLogsService } from '../ticket-time-logs.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Ticket time logs verification FAILED: ${message}`);
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

  const slug = `ticket-time-logs-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Ticket Time Logs Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Test Contact', 'test@example.com'],
  );
  const {
    rows: [agentUser],
  } = await migrator.query(
    `INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES ($1, $2, $3, 'x', 'agent') RETURNING id`,
    [tenant.id, 'time-log-agent@example.com', 'Time Log Agent'],
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
  const timeLogs = app.get(TicketTimeLogsService);

  try {
    const ticket = await ticketsService.create(tenant.id, {
      subject: 'Needs time tracked',
      contactId: contact.id,
      source: 'api',
    });

    let badAgent: any = null;
    try {
      await timeLogs.create(tenant.id, ticket.id, {
        minutes: 15,
        agentId: '00000000-0000-4000-8000-000000000000',
      });
    } catch (err) {
      badAgent = err;
    }
    assert(
      badAgent?.status === 400,
      "logging time with an agentId that doesn't belong to this tenant is rejected (400)",
    );

    const log1 = await timeLogs.create(tenant.id, ticket.id, {
      minutes: 30,
      note: 'Investigated logs',
      agentId: agent.id,
    });
    assert(
      log1.minutes === 30 && log1.agent_id === agent.id,
      'a time log is created with minutes and agent attribution',
    );

    await timeLogs.create(tenant.id, ticket.id, {
      minutes: 45,
      note: 'Applied fix',
    });

    const { items, totalMinutes } = await timeLogs.list(tenant.id, ticket.id);
    assert(
      items.length === 2,
      `list() returns both logs (got ${items.length})`,
    );
    assert(
      totalMinutes === 75,
      `totalMinutes sums all logs on the ticket (got ${totalMinutes})`,
    );

    await timeLogs.remove(tenant.id, ticket.id, log1.id);
    const afterDelete = await timeLogs.list(tenant.id, ticket.id);
    assert(afterDelete.totalMinutes === 45, 'removing a log updates the total');

    console.log('\nAll ticket time log checks passed.');
  } finally {
    await migrator.query(`DELETE FROM ticket_time_logs WHERE tenant_id = $1`, [
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
