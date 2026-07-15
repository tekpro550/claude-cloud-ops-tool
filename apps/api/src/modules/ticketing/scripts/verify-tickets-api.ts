import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import * as request from 'supertest';
import { AppModule } from '../../../app.module';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Ticket API verification FAILED: ${message}`);
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

/**
 * Boots the real HTTP app (same bootstrap as main.ts) and drives the Sprint
 * 1.2 ticket API over real HTTP requests against real Postgres, including
 * the cross-tenant guard rails that only matter once there's an API surface
 * to try to break: a missing tenant header, and a foreign id (agentId)
 * belonging to a different tenant than the one making the request.
 */
async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `tickets-api-verify-${Date.now()}`;
  const {
    rows: [tenantA],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Tickets API Verify A', `${slug}-a`],
  );
  const {
    rows: [tenantB],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Tickets API Verify B', `${slug}-b`],
  );
  const {
    rows: [userB],
  } = await migrator.query(
    `INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES ($1, $2, $3, 'x', 'agent') RETURNING id`,
    [tenantB.id, 'b-agent@example.com', 'B Agent'],
  );
  const {
    rows: [agentB],
  } = await migrator.query(
    `INSERT INTO agents (tenant_id, user_id) VALUES ($1, $2) RETURNING id`,
    [tenantB.id, userB.id],
  );

  const app: INestApplication = await NestFactory.create(AppModule, {
    logger: false,
  });
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(','),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Tenant-Id'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
  const server = app.getHttpServer();

  try {
    const noHeaderRes = await request(server).get('/api/v1/tickets');
    assert(
      noHeaderRes.status === 401,
      'GET /tickets without X-Tenant-Id is rejected with 401',
    );

    const create1 = await request(server)
      .post('/api/v1/tickets')
      .set('X-Tenant-Id', tenantA.id)
      .send({
        subject: 'First ticket',
        contact: { name: 'Alice', email: 'alice@example.com' },
        source: 'api',
      });
    assert(
      create1.status === 201,
      `POST /tickets creates a ticket (status=${create1.status})`,
    );
    assert(
      create1.body.ticket_number === 1,
      'first ticket in a tenant gets ticket_number 1',
    );
    const contactId = create1.body.contact_id;

    const create2 = await request(server)
      .post('/api/v1/tickets')
      .set('X-Tenant-Id', tenantA.id)
      .send({
        subject: 'Second ticket',
        contact: { name: 'Alice', email: 'alice@example.com' },
        source: 'api',
      });
    assert(create2.status === 201, 'second POST /tickets succeeds');
    assert(
      create2.body.ticket_number === 2,
      'ticket numbering is sequential per tenant (2)',
    );
    assert(
      create2.body.contact_id === contactId,
      'same email reuses the existing contact instead of duplicating it',
    );

    const crossTenantAgent = await request(server)
      .post('/api/v1/tickets')
      .set('X-Tenant-Id', tenantA.id)
      .send({
        subject: 'Should fail',
        contactId,
        source: 'api',
        agentId: agentB.id,
      });
    assert(
      crossTenantAgent.status === 400,
      'creating a ticket with an agentId from a different tenant is rejected (400), not silently accepted via the FK',
    );

    const ticketId = create1.body.id;

    const listRes = await request(server)
      .get('/api/v1/tickets')
      .set('X-Tenant-Id', tenantA.id);
    assert(
      listRes.status === 200 && listRes.body.total === 2,
      'GET /tickets lists both tickets for tenant A',
    );

    const getAsA = await request(server)
      .get(`/api/v1/tickets/${ticketId}`)
      .set('X-Tenant-Id', tenantA.id);
    assert(
      getAsA.status === 200 && getAsA.body.subject === 'First ticket',
      'GET /tickets/:id returns the ticket for its own tenant',
    );

    const getAsB = await request(server)
      .get(`/api/v1/tickets/${ticketId}`)
      .set('X-Tenant-Id', tenantB.id);
    assert(
      getAsB.status === 404,
      "GET /tickets/:id for another tenant's ticket returns 404, not the other tenant's data",
    );

    const patchRes = await request(server)
      .patch(`/api/v1/tickets/${ticketId}`)
      .set('X-Tenant-Id', tenantA.id)
      .send({ status: 'resolved' });
    assert(
      patchRes.status === 200 && patchRes.body.status === 'resolved',
      'PATCH /tickets/:id updates status',
    );
    assert(
      patchRes.body.resolved_at !== null,
      'resolved_at is set when status moves to resolved',
    );

    const filterRes = await request(server)
      .get('/api/v1/tickets?status=resolved')
      .set('X-Tenant-Id', tenantA.id);
    assert(
      filterRes.body.total === 1 && filterRes.body.items[0].id === ticketId,
      'GET /tickets?status=resolved filters correctly',
    );

    // Neither ticket was ever assigned an agent, so the unassigned=true
    // quick-view filter (agent_id IS NULL) should match both.
    const unassignedRes = await request(server)
      .get('/api/v1/tickets?unassigned=true')
      .set('X-Tenant-Id', tenantA.id);
    assert(
      unassignedRes.body.total === 2,
      `GET /tickets?unassigned=true matches both agent-less tickets (got ${unassignedRes.body.total})`,
    );

    // Neither ticket has an sla_policy_id, so there's no due date to be
    // overdue against -- overdue=true should match none.
    const overdueRes = await request(server)
      .get('/api/v1/tickets?overdue=true')
      .set('X-Tenant-Id', tenantA.id);
    assert(
      overdueRes.body.total === 0,
      `GET /tickets?overdue=true matches nothing when no ticket has an SLA due date (got ${overdueRes.body.total})`,
    );

    const messageRes = await request(server)
      .post(`/api/v1/tickets/${ticketId}/messages`)
      .set('X-Tenant-Id', tenantA.id)
      .send({
        type: 'note',
        authorType: 'system',
        body: 'Sprint 1.2 verification note',
      });
    assert(
      messageRes.status === 201 &&
        messageRes.body.body === 'Sprint 1.2 verification note',
      'POST /tickets/:id/messages adds a message',
    );

    const listMessagesRes = await request(server)
      .get(`/api/v1/tickets/${ticketId}/messages`)
      .set('X-Tenant-Id', tenantA.id);
    assert(
      listMessagesRes.status === 200 &&
        listMessagesRes.body.length === 1 &&
        listMessagesRes.body[0].body === 'Sprint 1.2 verification note',
      'GET /tickets/:id/messages lists the messages just added',
    );

    console.log('\nAll ticket API checks passed.');
  } finally {
    await app.close();
    await migrator.query(
      `DELETE FROM ticket_messages WHERE tenant_id IN ($1, $2)`,
      [tenantA.id, tenantB.id],
    );
    await migrator.query(`DELETE FROM tickets WHERE tenant_id IN ($1, $2)`, [
      tenantA.id,
      tenantB.id,
    ]);
    await migrator.query(
      `DELETE FROM ticket_number_counters WHERE tenant_id IN ($1, $2)`,
      [tenantA.id, tenantB.id],
    );
    await migrator.query(`DELETE FROM contacts WHERE tenant_id IN ($1, $2)`, [
      tenantA.id,
      tenantB.id,
    ]);
    await migrator.query(`DELETE FROM agents WHERE tenant_id IN ($1, $2)`, [
      tenantA.id,
      tenantB.id,
    ]);
    await migrator.query(`DELETE FROM users WHERE tenant_id IN ($1, $2)`, [
      tenantA.id,
      tenantB.id,
    ]);
    await migrator.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [
      tenantA.id,
      tenantB.id,
    ]);
    await migrator.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
