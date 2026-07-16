import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { sanitizeTicketBody, htmlToPlainText } from '../sanitize-html';
import { TicketsService } from '../tickets.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Rich text verification FAILED: ${message}`);
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
  // --- Pure sanitizer behaviour ---
  const xss = sanitizeTicketBody(
    '<p onclick="steal()">Hi <b>there</b><script>alert(1)</script></p>',
  );
  assert(!xss.includes('<script'), 'script tags are stripped');
  assert(!xss.includes('onclick'), 'inline event handlers are stripped');
  assert(
    xss.includes('<b>there</b>') && xss.includes('<p>'),
    'allowed formatting tags are preserved',
  );

  const link = sanitizeTicketBody('<a href="javascript:alert(1)">x</a>');
  assert(
    !link.includes('javascript:'),
    'javascript: URLs are dropped from links',
  );

  const safeLink = sanitizeTicketBody('<a href="https://example.com">docs</a>');
  assert(
    safeLink.includes('rel="noopener noreferrer"') &&
      safeLink.includes('target="_blank"'),
    'http(s) links are forced to open safely in a new tab',
  );

  assert(
    htmlToPlainText('<p>Line one</p><p>Line two</p>') === 'Line one\nLine two',
    'htmlToPlainText renders block elements as newlines and strips tags',
  );

  // --- End-to-end: a reply with HTML is stored sanitized ---
  const migrator = migratorClient();
  await migrator.connect();
  const slug = `rich-text-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Rich Text Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'RT Contact', 'rt@example.com'],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const tickets = app.get(TicketsService);

  try {
    const ticket = await tickets.create(tenant.id, {
      subject: 'Rich text ticket',
      contactId: contact.id,
      source: 'web_form',
    });
    await tickets.addMessage(tenant.id, ticket.id, {
      type: 'note',
      authorType: 'agent',
      body: '<p>Please <b>escalate</b> this <script>evil()</script></p>',
    });
    const {
      rows: [row],
    } = await migrator.query(
      `SELECT body FROM ticket_messages WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [tenant.id],
    );
    assert(
      row.body.includes('<b>escalate</b>') && !row.body.includes('<script'),
      'a stored reply keeps its formatting but has scripts stripped at the DB layer',
    );

    console.log('\nAll rich text checks passed.');
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
