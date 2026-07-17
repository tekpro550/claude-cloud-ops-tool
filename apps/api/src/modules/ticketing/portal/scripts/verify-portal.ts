import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import * as request from 'supertest';
import { AppModule } from '../../../../app.module';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Portal verification FAILED: ${message}`);
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

  const slug = `portal-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Portal Verify', slug],
  );

  const app: INestApplication = await NestFactory.create(AppModule, {
    logger: false,
  });
  app.setGlobalPrefix('api/v1');
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
    // ---- Guest ticket submission (no login) ----
    const submitRes = await request(server)
      .post('/api/v1/portal/tickets')
      .set('X-Tenant-Id', tenant.id)
      .send({
        name: 'Guest Requester',
        email: 'guest@portal-verify.example',
        subject: 'My VPN keeps dropping',
        description: 'It disconnects every few minutes.',
      });
    assert(
      submitRes.status === 201,
      `a guest can submit a ticket with no auth (status=${submitRes.status})`,
    );
    assert(
      submitRes.body.source === 'web_portal',
      'the submitted ticket has source=web_portal',
    );

    const missingField = await request(server)
      .post('/api/v1/portal/tickets')
      .set('X-Tenant-Id', tenant.id)
      .send({ name: 'No Email', subject: 'x', description: 'y' });
    assert(
      missingField.status === 400,
      'a guest submission missing a required field (email) is rejected with 400',
    );

    // ---- Registration ----
    const registerRes = await request(server)
      .post('/api/v1/portal/auth/register')
      .set('X-Tenant-Id', tenant.id)
      .send({
        name: 'Guest Requester',
        email: 'guest@portal-verify.example',
        password: 'super-secret-1',
      });
    assert(
      registerRes.status === 201 && typeof registerRes.body.token === 'string',
      `registering with the same email as the earlier guest submission succeeds and issues a token (status=${registerRes.status})`,
    );
    const {
      rows: [contactRow],
    } = await migrator.query(
      `SELECT id FROM contacts WHERE tenant_id = $1 AND email = $2`,
      [tenant.id, 'guest@portal-verify.example'],
    );
    assert(
      registerRes.body.contact.id === contactRow.id,
      'registration claimed the existing contact from the guest submission rather than creating a duplicate',
    );

    const doubleRegister = await request(server)
      .post('/api/v1/portal/auth/register')
      .set('X-Tenant-Id', tenant.id)
      .send({
        name: 'Guest Requester',
        email: 'guest@portal-verify.example',
        password: 'another-password',
      });
    assert(
      doubleRegister.status === 409,
      'registering again with the same, already-claimed email is rejected with 409',
    );

    // ---- Login ----
    const wrongPassword = await request(server)
      .post('/api/v1/portal/auth/login')
      .set('X-Tenant-Id', tenant.id)
      .send({ email: 'guest@portal-verify.example', password: 'wrong' });
    assert(
      wrongPassword.status === 401,
      'portal login with the wrong password is rejected with 401',
    );

    const loginRes = await request(server)
      .post('/api/v1/portal/auth/login')
      .set('X-Tenant-Id', tenant.id)
      .send({
        email: 'guest@portal-verify.example',
        password: 'super-secret-1',
      });
    assert(
      loginRes.status === 201,
      'portal login with the right password succeeds',
    );
    const contactToken = loginRes.body.token;

    const unregisteredLogin = await request(server)
      .post('/api/v1/portal/auth/login')
      .set('X-Tenant-Id', tenant.id)
      .send({ email: 'never-registered@portal-verify.example', password: 'x' });
    assert(
      unregisteredLogin.status === 401,
      'logging in as an email with no registered account is rejected with 401, not 404',
    );

    // ---- Contact-scoped ticket views ----
    const noAuthList = await request(server)
      .get('/api/v1/portal/tickets')
      .set('X-Tenant-Id', tenant.id);
    assert(
      noAuthList.status === 401,
      'GET /portal/tickets requires a Bearer token -- X-Tenant-Id alone is not enough',
    );

    const listRes = await request(server)
      .get('/api/v1/portal/tickets')
      .set('Authorization', `Bearer ${contactToken}`);
    assert(
      listRes.status === 200 &&
        listRes.body.length === 1 &&
        listRes.body[0].id === submitRes.body.id,
      "the logged-in contact's ticket list includes the ticket from their earlier guest submission",
    );

    const detailRes = await request(server)
      .get(`/api/v1/portal/tickets/${submitRes.body.id}`)
      .set('Authorization', `Bearer ${contactToken}`);
    assert(
      detailRes.status === 200 &&
        detailRes.body.messages.length === 1 &&
        detailRes.body.messages[0].body === 'It disconnects every few minutes.',
      "the ticket detail includes the contact's own message thread",
    );

    // A second, unrelated contact must never see the first contact's tickets.
    const otherRegisterRes = await request(server)
      .post('/api/v1/portal/auth/register')
      .set('X-Tenant-Id', tenant.id)
      .send({
        name: 'Someone Else',
        email: 'someone-else@portal-verify.example',
        password: 'another-password-1',
      });
    const otherToken = otherRegisterRes.body.token;

    const crossContactDetail = await request(server)
      .get(`/api/v1/portal/tickets/${submitRes.body.id}`)
      .set('Authorization', `Bearer ${otherToken}`);
    assert(
      crossContactDetail.status === 404,
      "a different contact's token gets 404 (not 403) for someone else's ticket, never confirming it exists",
    );

    const otherListRes = await request(server)
      .get('/api/v1/portal/tickets')
      .set('Authorization', `Bearer ${otherToken}`);
    assert(
      otherListRes.status === 200 && otherListRes.body.length === 0,
      "a contact with no tickets of their own sees an empty list, not another contact's tickets",
    );

    // An agent-kind token must never authorize a portal (contact) endpoint.
    await migrator.query(
      `INSERT INTO users (tenant_id, email, name, password_hash, role)
       VALUES ($1, 'agent@portal-verify.example', 'Agent', crypt('correct-horse', gen_salt('bf')), 'agent')`,
      [tenant.id],
    );
    const agentLoginRes = await request(server)
      .post('/api/v1/auth/login')
      .set('X-Tenant-Id', tenant.id)
      .send({
        email: 'agent@portal-verify.example',
        password: 'correct-horse',
      });
    const agentToken = agentLoginRes.body.token;
    const agentTokenOnPortal = await request(server)
      .get('/api/v1/portal/tickets')
      .set('Authorization', `Bearer ${agentToken}`);
    assert(
      agentTokenOnPortal.status === 401,
      "an agent's own login token is rejected on portal (contact-only) endpoints",
    );

    // ---- Public solutions (knowledge base) browsing ----
    const {
      rows: [draftSolution],
    } = await migrator.query(
      `INSERT INTO solutions (tenant_id, title, body, is_published) VALUES ($1, 'Draft article', 'not ready yet', false) RETURNING id`,
      [tenant.id],
    );
    const {
      rows: [publishedSolution],
    } = await migrator.query(
      `INSERT INTO solutions (tenant_id, title, body, is_published) VALUES ($1, 'How to reset your password', 'Click forgot password.', true) RETURNING id`,
      [tenant.id],
    );

    const publicList = await request(server)
      .get('/api/v1/portal/solutions')
      .set('X-Tenant-Id', tenant.id);
    assert(
      publicList.status === 200 &&
        publicList.body.length === 1 &&
        publicList.body[0].id === publishedSolution.id,
      'GET /portal/solutions (no auth) lists only published articles, not drafts',
    );

    const publicDraftGet = await request(server)
      .get(`/api/v1/portal/solutions/${draftSolution.id}`)
      .set('X-Tenant-Id', tenant.id);
    assert(
      publicDraftGet.status === 404,
      "fetching an unpublished article's id directly returns 404, not a 403 that would confirm it exists",
    );

    const publicPublishedGet = await request(server)
      .get(`/api/v1/portal/solutions/${publishedSolution.id}`)
      .set('X-Tenant-Id', tenant.id);
    assert(
      publicPublishedGet.status === 200,
      'fetching a published article by id succeeds with no auth',
    );

    console.log('\nAll portal checks passed.');
  } finally {
    await app.close();
    await migrator.query(`DELETE FROM solutions WHERE tenant_id = $1`, [
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
    await migrator.query(`DELETE FROM contacts WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM users WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
    await migrator.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
