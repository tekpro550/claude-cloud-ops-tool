import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { AiCompletionClient } from '../ai-completion.client';
import { TicketAiService } from '../ticket-ai.service';
import { TicketsService } from '../../tickets.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Ticket AI verification FAILED: ${message}`);
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

// Fake backend: records the prompts it was given and echoes a canned answer,
// so we can assert on what the service sent without any network/API key.
class FakeCompletionClient implements AiCompletionClient {
  readonly enabled = true;
  lastSystem = '';
  lastUser = '';
  async complete(system: string, user: string): Promise<string> {
    this.lastSystem = system;
    this.lastUser = user;
    return system.includes('draft the next reply') || system.includes('drafting the next reply')
      ? 'Thanks for reaching out — here is how to reset your password...'
      : 'Customer cannot log in; agent asked for their account email.';
  }
}

class DisabledFake implements AiCompletionClient {
  readonly enabled = false;
  async complete(): Promise<string> {
    throw new Error('should not be called');
  }
}

async function main() {
  const migrator = migratorClient();
  await migrator.connect();
  const slug = `ticket-ai-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Ticket AI Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'AI Contact', 'ai@example.com'],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const dataSource = app.get(DataSource);
  const tickets = app.get(TicketsService);

  try {
    const ticket = await tickets.create(tenant.id, {
      subject: 'Cannot log in',
      contactId: contact.id,
      source: 'web_form',
    });
    await tickets.addMessage(tenant.id, ticket.id, {
      type: 'reply',
      authorType: 'contact',
      body: 'I keep getting "invalid password" even after resetting.',
    });
    await tickets.addMessage(tenant.id, ticket.id, {
      type: 'reply',
      authorType: 'agent',
      body: 'Can you confirm the email on the account?',
    });

    // --- enabled path: summarize ---
    const fake = new FakeCompletionClient();
    const service = new TicketAiService(dataSource, fake);

    const summary = await service.summarize(tenant.id, ticket.id);
    assert(summary.enabled === true, 'summarize reports enabled when a client is present');
    assert(!!summary.result && summary.result.length > 0, 'summarize returns text');
    assert(
      fake.lastUser.includes('Cannot log in') &&
        fake.lastUser.includes('invalid password'),
      'the transcript passed to the model includes the subject and the customer message',
    );
    assert(
      fake.lastUser.includes('Customer:') && fake.lastUser.includes('Agent:'),
      'the transcript labels each author (Customer / Agent)',
    );

    // --- enabled path: suggest reply ---
    const reply = await service.suggestReply(tenant.id, ticket.id);
    assert(reply.enabled === true && !!reply.result, 'suggestReply returns a drafted reply');
    assert(
      fake.lastSystem.toLowerCase().includes('reply'),
      'suggestReply uses the reply-drafting system prompt',
    );

    // --- disabled path ---
    const disabled = new TicketAiService(dataSource, new DisabledFake());
    assert(disabled.status().enabled === false, 'status reflects a disabled client');
    const disabledResult = await disabled.summarize(tenant.id, ticket.id);
    assert(
      disabledResult.enabled === false && disabledResult.result === undefined,
      'summarize short-circuits to {enabled:false} when the client is disabled',
    );

    console.log('\nAll ticket AI checks passed.');
  } finally {
    await migrator.query(`DELETE FROM ticket_messages WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM ticket_activities WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM tickets WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM ticket_number_counters WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM contacts WHERE tenant_id = $1`, [tenant.id]);
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
