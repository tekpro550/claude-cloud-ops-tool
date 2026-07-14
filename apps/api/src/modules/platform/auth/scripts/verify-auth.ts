import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { Client } from 'pg';
import * as request from 'supertest';
import { AppModule } from '../../../../app.module';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Auth verification FAILED: ${message}`);
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

  const slug = `auth-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Auth Verify', slug],
  );
  const {
    rows: [user],
  } = await migrator.query(
    `INSERT INTO users (tenant_id, email, name, password_hash, role)
     VALUES ($1, $2, $3, crypt('correct-horse', gen_salt('bf')), 'agent') RETURNING id`,
    [tenant.id, 'agent@auth-verify.example', 'Auth Verify Agent'],
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
    const wrongPassword = await request(server)
      .post('/api/v1/auth/login')
      .set('X-Tenant-Id', tenant.id)
      .send({ email: 'agent@auth-verify.example', password: 'nope' });
    assert(
      wrongPassword.status === 401,
      'login with the wrong password is rejected with 401',
    );

    const unknownEmail = await request(server)
      .post('/api/v1/auth/login')
      .set('X-Tenant-Id', tenant.id)
      .send({ email: 'nobody@auth-verify.example', password: 'nope' });
    assert(
      unknownEmail.status === 401,
      'login with an unknown email is rejected with 401 (not a distinguishable 404)',
    );

    const loginRes = await request(server)
      .post('/api/v1/auth/login')
      .set('X-Tenant-Id', tenant.id)
      .send({ email: 'agent@auth-verify.example', password: 'correct-horse' });
    assert(
      loginRes.status === 201 && typeof loginRes.body.token === 'string',
      `a correct email+password issues a token (status=${loginRes.status})`,
    );
    assert(
      loginRes.body.user.id === user.id && loginRes.body.user.role === 'agent',
      'the login response includes the matching user record',
    );
    const token = loginRes.body.token;

    const meNoToken = await request(server)
      .get('/api/v1/auth/me')
      .set('X-Tenant-Id', tenant.id);
    assert(
      meNoToken.status === 401,
      'GET /auth/me with only X-Tenant-Id (no Bearer token) is rejected with 401',
    );

    const meRes = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    assert(
      meRes.status === 200 && meRes.body.id === user.id,
      "GET /auth/me with a Bearer token resolves the logged-in agent's own record",
    );

    // Additive rollout: the pre-existing tenant-header-only path must still
    // work unmodified on every other endpoint.
    const listViaHeader = await request(server)
      .get('/api/v1/tickets')
      .set('X-Tenant-Id', tenant.id);
    assert(
      listViaHeader.status === 200,
      'a pre-existing endpoint (GET /tickets) still works with only X-Tenant-Id, unaffected by the auth rollout',
    );

    const listViaToken = await request(server)
      .get('/api/v1/tickets')
      .set('Authorization', `Bearer ${token}`);
    assert(
      listViaToken.status === 200,
      'the same endpoint also works with a Bearer token instead of X-Tenant-Id, resolving the tenant from the JWT',
    );

    const garbageToken = await request(server)
      .get('/api/v1/tickets')
      .set('Authorization', 'Bearer not-a-real-jwt');
    assert(
      garbageToken.status === 401,
      'a malformed bearer token is rejected with 401, not silently ignored',
    );

    // A portal (contact) token must never authorize agent-only endpoints,
    // even though both are signed with the same secret.
    const contactToken = jwt.sign(
      {
        sub: '00000000-0000-4000-8000-000000000000',
        tenantId: tenant.id,
        email: 'contact@example.com',
        kind: 'contact',
      },
      process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me',
    );
    const contactTokenOnAgentRoute = await request(server)
      .get('/api/v1/tickets')
      .set('Authorization', `Bearer ${contactToken}`);
    assert(
      contactTokenOnAgentRoute.status === 401,
      "a contact-kind token is rejected on an agent endpoint, even though it's validly signed",
    );

    // A present-but-invalid bearer token must fall back to X-Tenant-Id
    // rather than hard-rejecting -- a stale/expired token in localStorage
    // shouldn't permanently lock a caller out of an endpoint their
    // X-Tenant-Id header alone would still be allowed to reach.
    const garbageTokenWithFallback = await request(server)
      .get('/api/v1/tickets')
      .set('Authorization', 'Bearer not-a-real-jwt')
      .set('X-Tenant-Id', tenant.id);
    assert(
      garbageTokenWithFallback.status === 200,
      'an invalid bearer token falls back to a valid X-Tenant-Id header instead of rejecting the request',
    );

    const contactTokenWithFallback = await request(server)
      .get('/api/v1/tickets')
      .set('Authorization', `Bearer ${contactToken}`)
      .set('X-Tenant-Id', tenant.id);
    assert(
      contactTokenWithFallback.status === 200,
      'a wrong-kind (contact) token on an agent endpoint also falls back to X-Tenant-Id rather than rejecting',
    );

    const garbageTokenNoFallback = await request(server)
      .get('/api/v1/tickets')
      .set('Authorization', 'Bearer not-a-real-jwt');
    assert(
      garbageTokenNoFallback.status === 401,
      'an invalid bearer token with no X-Tenant-Id fallback available is still rejected with 401',
    );

    // ---- Message attribution: a logged-in agent's replies are attributed
    // to them server-side, not left as a spoofable client-supplied value ----
    const {
      rows: [agent],
    } = await migrator.query(
      `INSERT INTO agents (tenant_id, user_id) VALUES ($1, $2) RETURNING id`,
      [tenant.id, user.id],
    );
    const {
      rows: [contact],
    } = await migrator.query(
      `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, 'Requester', 'req@auth-verify.example') RETURNING id`,
      [tenant.id],
    );
    const createTicketRes = await request(server)
      .post('/api/v1/tickets')
      .set('X-Tenant-Id', tenant.id)
      .send({
        subject: 'Attribution test',
        contactId: contact.id,
        source: 'web_form',
      });
    const ticketId = createTicketRes.body.id;

    const authedMessageRes = await request(server)
      .post(`/api/v1/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'reply',
        authorType: 'system',
        body: 'Reply from a logged-in agent',
      });
    assert(
      authedMessageRes.body.author_type === 'agent' &&
        authedMessageRes.body.author_id === agent.id,
      'a message posted with a valid agent Bearer token is attributed to that agent, overriding the client-supplied authorType/authorId (got author_type=' +
        authedMessageRes.body.author_type +
        ')',
    );

    const unauthedMessageRes = await request(server)
      .post(`/api/v1/tickets/${ticketId}/messages`)
      .set('X-Tenant-Id', tenant.id)
      .send({
        type: 'note',
        authorType: 'system',
        body: 'Note from a bare header caller',
      });
    assert(
      unauthedMessageRes.body.author_type === 'system',
      'a message posted with only X-Tenant-Id (no verified identity) keeps the client-supplied authorType unchanged',
    );

    console.log('\nAll auth checks passed.');
  } finally {
    await app.close();
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
    await migrator.query(`DELETE FROM agents WHERE tenant_id = $1`, [
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
