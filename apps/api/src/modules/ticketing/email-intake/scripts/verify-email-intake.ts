import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { TicketsService } from '../../tickets.service';
import { processInboundEmail } from '../process-inbound-email';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Email intake verification FAILED: ${message}`);
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

function buildRawEmail(opts: {
  from: string;
  subject: string;
  body: string;
  messageId: string;
}): string {
  return [
    `From: "Jane Customer" <${opts.from}>`,
    `To: cloud.support@tekprocloud.com`,
    `Subject: ${opts.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${opts.messageId}>`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    opts.body,
    ``,
  ].join('\r\n');
}

/**
 * Proves the mail -> ticket transformation without needing a real mailbox
 * (this sandbox can't reach one): feeds processInboundEmail() synthetic
 * .eml content directly, against the real ticketing service and Postgres.
 * The IMAP polling loop (email-intake.service.ts) is a thin, separately
 * reviewed wrapper around this function using a well-established library
 * (imapflow), not exercised here.
 */
async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `email-intake-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Email Intake Verify', slug],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const ticketsService = app.get(TicketsService);

  try {
    const email1 = buildRawEmail({
      from: 'jane@example.com',
      subject: 'My server is down',
      body: 'Hi, our production server has been unreachable since this morning. Please help.',
      messageId: 'msg1@example.com',
    });
    const result1 = await processInboundEmail(
      ticketsService,
      tenant.id,
      email1,
    );
    assert(result1.created, 'first inbound email creates a new ticket');
    assert(result1.ticketNumber === 1, 'new ticket gets ticket_number 1');

    const ticket1 = await ticketsService.get(tenant.id, result1.ticketId);
    assert(
      ticket1.subject === 'My server is down',
      'ticket subject matches the email subject',
    );
    assert(ticket1.source === 'email', 'ticket source is "email"');

    const messages1 = await ticketsService.listMessages(
      tenant.id,
      result1.ticketId,
    );
    assert(
      messages1.length === 1 &&
        messages1[0].body.includes('unreachable since this morning'),
      'the email body was stored as the first ticket message',
    );
    assert(
      messages1[0].author_type === 'contact',
      'the message is attributed to the contact, not an agent or system',
    );

    const contact1 = await migrator.query(
      `SELECT id, name, email FROM contacts WHERE tenant_id = $1`,
      [tenant.id],
    );
    assert(
      contact1.rows.length === 1 &&
        contact1.rows[0].email === 'jane@example.com',
      'a contact was created from the From header',
    );
    const contactId = contact1.rows[0].id;

    const email2 = buildRawEmail({
      from: 'jane@example.com',
      subject: 'A completely different issue',
      body: 'Separate problem, not related to the first email.',
      messageId: 'msg2@example.com',
    });
    const result2 = await processInboundEmail(
      ticketsService,
      tenant.id,
      email2,
    );
    assert(
      result2.created,
      'a second unrelated email creates a second ticket, not a reply on the first',
    );
    assert(
      result2.ticketNumber === 2,
      'ticket numbering continues sequentially (2)',
    );

    const contactAfterSecond = await migrator.query(
      `SELECT id FROM contacts WHERE tenant_id = $1`,
      [tenant.id],
    );
    assert(
      contactAfterSecond.rows.length === 1 &&
        contactAfterSecond.rows[0].id === contactId,
      'the same contact (matched by email) is reused, not duplicated',
    );

    const replyEmail = buildRawEmail({
      from: 'jane@example.com',
      subject: `Re: My server is down [Ticket #${result1.ticketNumber}]`,
      body: "Update: it came back on its own, but I'd still like to know what happened.",
      messageId: 'msg3@example.com',
    });
    const result3 = await processInboundEmail(
      ticketsService,
      tenant.id,
      replyEmail,
    );
    assert(
      !result3.created,
      'a reply tagged with [Ticket #N] threads onto the existing ticket instead of creating a new one',
    );
    assert(
      result3.ticketId === result1.ticketId,
      'the threaded reply lands on the correct ticket',
    );

    const messagesAfterReply = await ticketsService.listMessages(
      tenant.id,
      result1.ticketId,
    );
    assert(
      messagesAfterReply.length === 2 &&
        messagesAfterReply[1].body.includes('came back on its own'),
      'the threaded reply was appended as a second message on the original ticket',
    );

    const ticketCountAfterReply = await migrator.query(
      `SELECT count(*)::int AS count FROM tickets WHERE tenant_id = $1`,
      [tenant.id],
    );
    assert(
      ticketCountAfterReply.rows[0].count === 2,
      'still only 2 tickets total -- the tagged reply did not create a third',
    );

    console.log('\nAll email intake checks passed.');
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
