import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { TicketsService } from '../tickets.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Compose outbound verification FAILED: ${message}`);
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

  const slug = `compose-outbound-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Compose Outbound Verify', slug],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const tickets = app.get(TicketsService);

  try {
    let missingContact: any = null;
    try {
      await tickets.composeOutbound(tenant.id, {
        subject: 'No contact given',
        body: 'hi',
      } as any);
    } catch (err) {
      missingContact = err;
    }
    assert(
      missingContact?.status === 400,
      'composing outbound with neither contactId nor contact is rejected (400)',
    );

    const ticket = await tickets.composeOutbound(tenant.id, {
      contact: { name: 'New Prospect', email: 'prospect@example.com' },
      subject: 'Following up on your renewal',
      body: 'Hi, just checking in about your upcoming renewal.',
    });
    assert(
      ticket.source === 'agent_outbound',
      `the ticket's source is agent_outbound (got ${ticket.source})`,
    );
    assert(
      ticket.subject === 'Following up on your renewal',
      'subject set correctly',
    );

    const { rows: contactRows } = await migrator.query(
      `SELECT id, name, email FROM contacts WHERE tenant_id = $1 AND email = $2`,
      [tenant.id, 'prospect@example.com'],
    );
    assert(
      contactRows.length === 1,
      'a new contact was created from the inline contact fields',
    );

    const messages = await tickets.listMessages(tenant.id, ticket.id);
    assert(
      messages.length === 1 &&
        messages[0].type === 'reply' &&
        messages[0].author_type === 'agent' &&
        messages[0].body ===
          'Hi, just checking in about your upcoming renewal.',
      "the composed body became the ticket's first message, authored by an agent",
    );

    // Composing again to the same contact should reuse the existing contact, not duplicate it.
    const ticket2 = await tickets.composeOutbound(tenant.id, {
      contact: { name: 'New Prospect', email: 'prospect@example.com' },
      subject: 'One more thing',
      body: 'Forgot to mention...',
    });
    const { rows: contactRowsAfter } = await migrator.query(
      `SELECT id FROM contacts WHERE tenant_id = $1 AND email = $2`,
      [tenant.id, 'prospect@example.com'],
    );
    assert(
      contactRowsAfter.length === 1 && ticket2.contact_id === contactRows[0].id,
      'composing outbound again to the same email reuses the existing contact rather than duplicating it',
    );

    console.log('\nAll compose outbound checks passed.');
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
