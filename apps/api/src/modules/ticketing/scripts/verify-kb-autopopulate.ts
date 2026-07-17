import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { SolutionsService } from '../solutions.service';
import { TicketsService } from '../tickets.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`KB auto-populate verification FAILED: ${message}`);
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
 * Proves resolving a ticket seeds an internal (unpublished) knowledge-base
 * article from the resolving agent reply, without duplicates, and that the
 * KB search filters over title/body.
 */
async function main() {
  const migrator = migratorClient();
  await migrator.connect();
  const slug = `kb-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['KB Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'KB Contact', 'kb@example.com'],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const tickets = app.get(TicketsService);
  const solutions = app.get(SolutionsService);

  try {
    // A ticket with an agent reply, then resolved -> a draft article appears.
    const ticket = await tickets.create(tenant.id, {
      subject: 'How do I reset my API token?',
      contactId: contact.id,
      source: 'web_form',
    });
    await tickets.addMessage(tenant.id, ticket.id, {
      type: 'reply',
      authorType: 'agent',
      body: 'Open Settings → API tokens, revoke the old one and click "Issue token".',
    });

    let kb = await solutions.list(tenant.id);
    assert(
      kb.length === 0,
      'no KB article exists before the ticket is resolved',
    );

    await tickets.update(tenant.id, ticket.id, { status: 'resolved' });

    kb = await solutions.list(tenant.id);
    assert(kb.length === 1, 'resolving the ticket auto-creates one KB article');
    const article = kb[0];
    assert(
      article.title === 'How do I reset my API token?',
      'the article title is the ticket subject',
    );
    assert(
      article.body.includes('Issue token'),
      'the article body is the resolving agent reply',
    );
    assert(
      article.is_published === false,
      'the auto-created article is a draft (internal-only until published)',
    );
    assert(
      article.source_ticket_id === ticket.id,
      'the article links back to its source ticket',
    );

    // Re-resolving (reopen -> resolve) must not create a duplicate.
    await tickets.update(tenant.id, ticket.id, { status: 'open' });
    await tickets.update(tenant.id, ticket.id, { status: 'resolved' });
    kb = await solutions.list(tenant.id);
    assert(kb.length === 1, 're-resolving does not create a duplicate article');

    // Search filters over title/body.
    const hit = await solutions.list(tenant.id, 'API token');
    assert(hit.length === 1, 'KB search matches on the title');
    const miss = await solutions.list(tenant.id, 'nonexistent-term-xyz');
    assert(
      miss.length === 0,
      'KB search returns nothing for an unmatched term',
    );

    // A ticket resolved with no agent reply is skipped.
    const noReply = await tickets.create(tenant.id, {
      subject: 'Silent ticket',
      contactId: contact.id,
      source: 'web_form',
    });
    await tickets.update(tenant.id, noReply.id, { status: 'resolved' });
    kb = await solutions.list(tenant.id);
    assert(
      kb.length === 1,
      'a ticket resolved with no agent reply creates no article',
    );

    console.log('\nAll KB auto-populate checks passed.');
  } finally {
    await migrator.query(`DELETE FROM solutions WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM ticket_messages WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM ticket_activities WHERE tenant_id = $1`, [
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
