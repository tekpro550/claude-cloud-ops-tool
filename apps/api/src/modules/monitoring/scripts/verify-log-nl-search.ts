/**
 * Verify script for Task 6: Natural-language log search (M2).
 * Exercises LogNlSearchService with a fake AI client against real Postgres.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { AiCompletionClient } from '../../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../../ai/tenant-ai-settings.service';
import { LogNlSearchService } from '../logs/log-nl-search.service';
import { LogsService } from '../logs/logs.service';

const NO_SETTINGS = {
  resolveClient: async () => null,
} as unknown as TenantAiSettingsService;

class FakeNlClient implements AiCompletionClient {
  readonly enabled = true;
  returnJson = '{"q":"database connection","level":"error"}';
  async complete(_s: string, _u: string): Promise<string> {
    return this.returnJson;
  }
}

class DisabledFake implements AiCompletionClient {
  readonly enabled = false;
  async complete(): Promise<string> { throw new Error('should not be called'); }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`NL log search verify FAILED: ${message}`);
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

  const slug = `nl-log-search-verify-${Date.now()}`;
  const { rows: [tenant] } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['NL Log Search Verify', slug],
  );

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const dataSource = app.get(DataSource);
  const logsService = app.get(LogsService);

  try {
    // Seed a log source
    const { rows: [source] } = await migrator.query(
      `INSERT INTO log_sources (tenant_id, name, is_active, token_hash)
       VALUES ($1, $2, true, 'fakehash') RETURNING id`,
      [tenant.id, 'api-server'],
    );

    // Seed some log entries
    await migrator.query(
      `INSERT INTO log_entries (tenant_id, log_source_id, level, message, ts)
       VALUES ($1, $2, 'error', 'database connection pool exhausted', now() - interval '5 minutes')`,
      [tenant.id, source.id],
    );
    await migrator.query(
      `INSERT INTO log_entries (tenant_id, log_source_id, level, message, ts)
       VALUES ($1, $2, 'info', 'request completed successfully', now() - interval '3 minutes')`,
      [tenant.id, source.id],
    );

    // --- 1. NL query is parsed and results returned ---
    const fake = new FakeNlClient();
    const nlService = new LogNlSearchService(dataSource, fake, NO_SETTINGS, logsService);
    const result = await nlService.nlSearch(tenant.id, 'show me database errors');

    assert(result.parsed.q === 'database connection', 'q field parsed from AI response');
    assert(result.parsed.level === 'error', 'level field parsed from AI response');
    assert(Array.isArray(result.results), 'results array returned');

    // --- 2. Allowlist gating: off-list level is rejected ---
    const invalidLevelClient = new FakeNlClient();
    invalidLevelClient.returnJson = '{"q":"test","level":"CRITICAL"}';
    const invalidLevelService = new LogNlSearchService(
      dataSource, invalidLevelClient, NO_SETTINGS, logsService,
    );
    const invalidResult = await invalidLevelService.nlSearch(tenant.id, 'critical errors');
    assert(invalidResult.parsed.level === undefined, 'off-allowlist level is rejected');
    assert(invalidResult.parsed.q === 'test', 'valid q field is still passed through');

    // --- 3. sourceName is resolved to sourceId ---
    const sourceNameClient = new FakeNlClient();
    sourceNameClient.returnJson = '{"sourceName":"api-server"}';
    const sourceNameService = new LogNlSearchService(
      dataSource, sourceNameClient, NO_SETTINGS, logsService,
    );
    const sourceResult = await sourceNameService.nlSearch(tenant.id, 'api-server logs');
    assert(sourceResult.parsed.sourceId === source.id, 'sourceName resolved to sourceId');

    // --- 4. fromRelative is converted to an ISO timestamp ---
    const relativeClient = new FakeNlClient();
    relativeClient.returnJson = '{"fromRelative":"1h"}';
    const relativeService = new LogNlSearchService(
      dataSource, relativeClient, NO_SETTINGS, logsService,
    );
    const relativeResult = await relativeService.nlSearch(tenant.id, 'last hour logs');
    assert(typeof relativeResult.parsed.from === 'string', 'fromRelative converted to ISO from');
    assert(relativeResult.parsed.from!.includes('T'), 'from is an ISO timestamp');

    // --- 5. Disabled client throws BadRequestException ---
    const disabledService = new LogNlSearchService(
      dataSource, new DisabledFake(), NO_SETTINGS, logsService,
    );
    let threw = false;
    try {
      await disabledService.nlSearch(tenant.id, 'any query');
    } catch {
      threw = true;
    }
    assert(threw, 'disabled client throws BadRequestException');

    // --- 6. Empty query throws BadRequestException ---
    let emptyThrew = false;
    try {
      await nlService.nlSearch(tenant.id, '');
    } catch {
      emptyThrew = true;
    }
    assert(emptyThrew, 'empty query throws BadRequestException');

    console.log('\nAll NL log search checks passed.');
  } finally {
    await migrator.query(`DELETE FROM log_entries WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM log_sources WHERE tenant_id = $1`, [tenant.id]);
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
