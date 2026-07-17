import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import * as request from 'supertest';
import { AppModule } from '../../../../app.module';
import { SearchService } from '../search.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Search verification FAILED: ${message}`);
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

  const slug = `search-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Search Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Zephyr Anderson', 'zephyr@example.com'],
  );
  await migrator.query(
    `INSERT INTO companies (tenant_id, name, domain) VALUES ($1, $2, $3)`,
    [tenant.id, 'Zephyr Industries', 'zephyr-industries.example'],
  );
  const {
    rows: [ticket],
  } = await migrator.query(
    `INSERT INTO tickets (tenant_id, ticket_number, subject, contact_id, source) VALUES ($1, 1, $2, $3, 'api') RETURNING id`,
    [tenant.id, 'VPN keeps disconnecting', contact.id],
  );
  await migrator.query(
    `INSERT INTO ticket_messages (tenant_id, ticket_id, type, author_type, body) VALUES ($1, $2, 'reply', 'agent', $3)`,
    [
      tenant.id,
      ticket.id,
      'Try the zephyr-vpn-client version 3.2 instead of the old one',
    ],
  );
  // Noise: a ticket that should never match "zephyr" searches.
  await migrator.query(
    `INSERT INTO tickets (tenant_id, ticket_number, subject, contact_id, source) VALUES ($1, 2, $2, $3, 'api')`,
    [tenant.id, 'Unrelated billing question', contact.id],
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
  const search = app.get(SearchService);

  try {
    const empty = await search.search(tenant.id, '');
    assert(
      empty.tickets.length === 0 &&
        empty.contacts.length === 0 &&
        empty.companies.length === 0,
      'an empty query returns no results rather than everything',
    );

    const all = await search.search(tenant.id, 'zephyr');
    assert(all.contacts.length === 1, 'search matches the contact by name');
    assert(all.companies.length === 1, 'search matches the company by name');
    assert(
      all.tickets.length === 1 && (all.tickets[0] as any).id === ticket.id,
      'search matches the ticket whose message body (not subject) contains the term',
    );

    const subjectMatch = await search.search(tenant.id, 'VPN');
    assert(
      subjectMatch.tickets.length === 1,
      'search also matches on the ticket subject directly',
    );

    const ticketsOnly = await search.search(tenant.id, 'zephyr', 'tickets');
    assert(
      ticketsOnly.tickets.length === 1 &&
        ticketsOnly.contacts.length === 0 &&
        ticketsOnly.companies.length === 0,
      'scope=tickets returns only ticket matches',
    );

    const contactsOnly = await search.search(tenant.id, 'zephyr', 'contacts');
    assert(
      contactsOnly.contacts.length === 1 && contactsOnly.tickets.length === 0,
      'scope=contacts returns only contact matches',
    );

    const noMatch = await search.search(tenant.id, 'nonexistentterm');
    assert(
      noMatch.tickets.length === 0 &&
        noMatch.contacts.length === 0 &&
        noMatch.companies.length === 0,
      'a term matching nothing returns empty arrays for every category',
    );

    // ---- Draft solutions: visible to an authenticated agent, hidden from a bare X-Tenant-Id caller ----
    await migrator.query(
      `INSERT INTO solutions (tenant_id, title, body, is_published) VALUES ($1, 'Zephyr VPN draft notes', 'unfinished draft content', false)`,
      [tenant.id],
    );
    await migrator.query(
      `INSERT INTO users (tenant_id, email, name, password_hash, role)
       VALUES ($1, 'agent@search-verify.example', 'Agent', crypt('correct-horse', gen_salt('bf')), 'agent')`,
      [tenant.id],
    );
    const loginRes = await request(server)
      .post('/api/v1/auth/login')
      .set('X-Tenant-Id', tenant.id)
      .send({
        email: 'agent@search-verify.example',
        password: 'correct-horse',
      });
    const agentToken = loginRes.body.token;

    const searchViaHeaderOnly = await request(server)
      .get('/api/v1/search?q=zephyr&scope=solutions')
      .set('X-Tenant-Id', tenant.id);
    assert(
      searchViaHeaderOnly.body.solutions.length === 0,
      'a bare X-Tenant-Id search (no verified agent identity) does not surface a draft solution',
    );

    const searchViaAgentToken = await request(server)
      .get('/api/v1/search?q=zephyr&scope=solutions')
      .set('Authorization', `Bearer ${agentToken}`);
    assert(
      searchViaAgentToken.body.solutions.length === 1,
      'a search authenticated with a verified agent JWT does surface the draft solution',
    );

    console.log('\nAll search checks passed.');
  } finally {
    await migrator.query(`DELETE FROM solutions WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM users WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM ticket_messages WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM tickets WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM contacts WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM companies WHERE tenant_id = $1`, [
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
