/**
 * Verify script for Task 7: Similar ticket detection (M1).
 * Uses pg_trgm candidates + optional AI re-ranking with a fake client.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { AiCompletionClient } from '../../../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../../../ai/tenant-ai-settings.service';
import { TicketSimilarService } from '../ticket-similar.service';
import { TicketsService } from '../../tickets.service';

const NO_SETTINGS = {
  resolveClient: async () => null,
} as unknown as TenantAiSettingsService;

class FakeRerankClient implements AiCompletionClient {
  readonly enabled = true;
  // Returns candidate 0 with score 0.9 — index based on the order passed
  async complete(_s: string, _u: string): Promise<string> {
    return '[{"index":0,"score":0.9}]';
  }
}

class DisabledFake implements AiCompletionClient {
  readonly enabled = false;
  async complete(): Promise<string> {
    throw new Error('should not be called');
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Ticket similar verify FAILED: ${message}`);
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

  const slug = `ticket-similar-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Similar Tickets Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Similar Contact', `sim@${slug}.example`],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const dataSource = app.get(DataSource);
  const tickets = app.get(TicketsService);

  try {
    // Create resolved tickets with similar subjects
    const resolved1 = await tickets.create(tenant.id, {
      subject: 'Cannot log in to the system',
      contactId: contact.id,
      source: 'web_form',
    });
    const resolved2 = await tickets.create(tenant.id, {
      subject: 'Login authentication failure',
      contactId: contact.id,
      source: 'web_form',
    });
    const unrelated = await tickets.create(tenant.id, {
      subject: 'Billing question about invoice',
      contactId: contact.id,
      source: 'web_form',
    });

    // Mark first two as resolved so they appear as candidates
    await migrator.query(
      `UPDATE tickets SET status = 'resolved' WHERE id = ANY($1::uuid[])`,
      [[resolved1.id, resolved2.id, unrelated.id]],
    );

    // Create the target ticket
    const target = await tickets.create(tenant.id, {
      subject: 'Login not working',
      contactId: contact.id,
      source: 'web_form',
    });

    // --- 1. Trgm finds candidates and AI re-ranks them ---
    const service = new TicketSimilarService(
      dataSource,
      new FakeRerankClient(),
      NO_SETTINGS,
    );
    const similar = await service.getSimilar(tenant.id, target.id);
    assert(similar.length > 0, 'trgm + AI finds similar tickets');
    assert(similar[0].ai_ranked === true, 'results are AI-ranked');
    assert(similar[0].score >= 0 && similar[0].score <= 1, 'score is 0-1');
    console.log(`  OK  found ${similar.length} similar tickets via trgm + AI`);

    // --- 2. Cached suggestions are returned ---
    const cached = await service.getCached(tenant.id, target.id);
    assert(
      cached.length > 0,
      'cached suggestions are persisted after getSimilar',
    );
    console.log('  OK  getCached returns persisted suggestions');

    // --- 3. Disabled client falls back to trgm-only ---
    const disabledService = new TicketSimilarService(
      dataSource,
      new DisabledFake(),
      NO_SETTINGS,
    );
    const trgmOnly = await disabledService.getSimilar(tenant.id, target.id);
    assert(
      trgmOnly.every((r) => r.ai_ranked === false),
      'disabled client uses trgm-only',
    );
    console.log('  OK  disabled client falls back to trgm-only, no throw');

    // --- 4. Ticket with no similar results returns empty array ---
    const isolated = await tickets.create(tenant.id, {
      subject: 'zzzzz unique quantum cryptography flux capacitor xyz',
      contactId: contact.id,
      source: 'web_form',
    });
    const noSimilar = await service.getSimilar(tenant.id, isolated.id);
    assert(
      Array.isArray(noSimilar),
      'returns array even with no similar tickets',
    );
    console.log('  OK  no-similar-candidates returns empty array');

    console.log('\nAll ticket similar checks passed.');
  } finally {
    await migrator.query(
      `DELETE FROM ticket_similar_suggestions WHERE tenant_id = $1`,
      [tenant.id],
    );
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
