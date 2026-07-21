/**
 * Verify script for Task 1 (auto-triage) and Task 3 (sentiment detection).
 * Uses fake AI client + real Postgres to exercise the full persist path.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { AiCompletionClient } from '../../../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../../../ai/tenant-ai-settings.service';
import { TicketTriageService } from '../ticket-triage.service';
import { TicketSentimentService } from '../ticket-sentiment.service';
import { TicketsService } from '../../tickets.service';

const NO_SETTINGS = {
  resolveClient: async () => null,
} as unknown as TenantAiSettingsService;

class FakeTriageClient implements AiCompletionClient {
  readonly enabled = true;
  returnValue =
    '{"priority":"high","typeId":null,"tags":[],"skill":null,"rationale":"Urgent issue"}';
  async complete(_s: string, _u: string): Promise<string> {
    return this.returnValue;
  }
}

class FakeSentimentClient implements AiCompletionClient {
  readonly enabled = true;
  returnValue =
    '{"sentiment":"negative","score":0.9,"rationale":"Customer is frustrated"}';
  async complete(_s: string, _u: string): Promise<string> {
    return this.returnValue;
  }
}

class DisabledFake implements AiCompletionClient {
  readonly enabled = false;
  async complete(): Promise<string> {
    throw new Error('should not be called');
  }
}

function assert(condition: boolean, message: string) {
  if (!condition)
    throw new Error(`AI triage/sentiment verify FAILED: ${message}`);
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

  const slug = `ai-triage-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['AI Triage Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Triage Contact', `triage@${slug}.example`],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const dataSource = app.get(DataSource);
  const tickets = app.get(TicketsService);

  // Fake config that returns defaults
  const fakeConfig = { get: (_k: string, def: unknown) => def } as any;

  try {
    // --- 1. Create a ticket (triage disabled mode — mode=off) ---
    const ticket = await tickets.create(tenant.id, {
      subject: 'Server is down!',
      contactId: contact.id,
      source: 'web_form',
    });

    // Manually set tenant_ai_settings mode to 'suggest' (model is NOT NULL)
    await migrator.query(
      `INSERT INTO tenant_ai_settings (tenant_id, model, auto_triage_mode)
       VALUES ($1, 'test-model', 'suggest')
       ON CONFLICT (tenant_id) DO UPDATE SET auto_triage_mode = 'suggest'`,
      [tenant.id],
    );

    // --- 2. TicketTriageService: suggest mode writes to ticket_ai_triage ---
    const fakeTriageClient = new FakeTriageClient();
    const triageService = new TicketTriageService(
      dataSource,
      fakeTriageClient,
      NO_SETTINGS,
      fakeConfig,
    );
    await triageService.triageTicket(tenant.id, ticket.id);

    const suggestion = await triageService.getTriageSuggestion(
      tenant.id,
      ticket.id,
    );
    assert(!!suggestion, 'triage suggestion was persisted');
    assert(
      suggestion.suggested_priority === 'high',
      'valid priority is stored',
    );
    assert(suggestion.applied === false, 'suggest mode does not auto-apply');

    // --- 3. Apply mode updates the ticket ---
    await migrator.query(
      `UPDATE tenant_ai_settings SET auto_triage_mode = 'apply' WHERE tenant_id = $1`,
      [tenant.id],
    );
    const triageApply = new TicketTriageService(
      dataSource,
      fakeTriageClient,
      NO_SETTINGS,
      fakeConfig,
    );
    await triageApply.triageTicket(tenant.id, ticket.id);
    const {
      rows: [updatedTicket],
    } = await migrator.query(`SELECT priority FROM tickets WHERE id = $1`, [
      ticket.id,
    ]);
    assert(
      updatedTicket.priority === 'high',
      'apply mode updates ticket priority',
    );

    // --- 4. Allowlist gating: unknown priority is rejected ---
    const fakeInvalid = new FakeTriageClient();
    fakeInvalid.returnValue =
      '{"priority":"CRITICAL","typeId":null,"tags":[],"skill":null,"rationale":"x"}';
    const triageInvalid = new TicketTriageService(
      dataSource,
      fakeInvalid,
      NO_SETTINGS,
      fakeConfig,
    );
    await triageInvalid.triageTicket(tenant.id, ticket.id);
    const latestSuggestion = await triageInvalid.getTriageSuggestion(
      tenant.id,
      ticket.id,
    );
    assert(
      latestSuggestion.suggested_priority === null,
      'off-allowlist priority is null',
    );

    // --- 5. Disabled client is a no-op ---
    const disabledTriage = new TicketTriageService(
      dataSource,
      new DisabledFake(),
      NO_SETTINGS,
      fakeConfig,
    );
    // Should not throw, just return
    await disabledTriage.triageTicket(tenant.id, ticket.id);
    assert(true, 'disabled client is a no-op (no throw)');

    // --- 6. TicketSentimentService: sentiment is detected and persisted ---
    await tickets.addMessage(tenant.id, ticket.id, {
      type: 'reply',
      authorType: 'contact',
      body: 'This is terrible! Fix it now!',
    });
    const sentimentService = new TicketSentimentService(
      dataSource,
      new FakeSentimentClient(),
      NO_SETTINGS,
    );
    await sentimentService.detectSentiment(tenant.id, ticket.id);
    const {
      rows: [sentimentTicket],
    } = await migrator.query(
      `SELECT sentiment, sentiment_score FROM tickets WHERE id = $1`,
      [ticket.id],
    );
    assert(sentimentTicket.sentiment === 'negative', 'sentiment is persisted');
    assert(Number(sentimentTicket.sentiment_score) > 0.5, 'score is persisted');

    // --- 7. Invalid sentiment label is rejected ---
    const invalidSentimentClient = new FakeSentimentClient();
    invalidSentimentClient.returnValue =
      '{"sentiment":"furious","score":0.9,"rationale":"x"}';
    const invalidSentiment = new TicketSentimentService(
      dataSource,
      invalidSentimentClient,
      NO_SETTINGS,
    );
    await invalidSentiment.detectSentiment(tenant.id, ticket.id);
    // sentiment should remain unchanged (furious is not in allowlist)
    const {
      rows: [sentimentAfter],
    } = await migrator.query(`SELECT sentiment FROM tickets WHERE id = $1`, [
      ticket.id,
    ]);
    assert(
      sentimentAfter.sentiment === 'negative',
      'off-allowlist sentiment is rejected',
    );

    console.log('\nAll AI triage + sentiment checks passed.');
  } finally {
    await migrator.query(`DELETE FROM ticket_ai_triage WHERE tenant_id = $1`, [
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
    await migrator.query(
      `DELETE FROM tenant_ai_settings WHERE tenant_id = $1`,
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
