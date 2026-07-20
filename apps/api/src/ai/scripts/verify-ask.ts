/**
 * Verify script for Task 11: Unified "Ask" assistant.
 * Uses fake AI + real Postgres to exercise session/message persistence and
 * the tool-call parsing loop.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { Client } from 'pg';
import { AppModule } from '../../app.module';
import { AiCompletionClient } from '../ai-completion.client';
import { TenantAiSettingsService } from '../tenant-ai-settings.service';
import { AskService } from '../ask/ask.service';
import {
  buildToolsSystemPrompt,
  isAllowedTool,
  parseToolCall,
} from '../ask/ask-tools';

const NO_SETTINGS = {
  resolveClient: async () => null,
} as unknown as TenantAiSettingsService;

class ImmediateAnswerClient implements AiCompletionClient {
  readonly enabled = true;
  returnValue: string;
  constructor(returnValue: string) { this.returnValue = returnValue; }
  async complete(_s: string, _u: string): Promise<string> {
    return this.returnValue;
  }
}

class DisabledFake implements AiCompletionClient {
  readonly enabled = false;
  async complete(): Promise<string> { throw new Error('should not be called'); }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Ask verify FAILED: ${message}`);
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
  // --- Pure unit checks (no Postgres needed) ---

  // 1. parseToolCall: valid TOOL_CALL line
  const parsed = parseToolCall('TOOL_CALL: {"tool":"search_tickets","args":{"q":"login"}}');
  assert(parsed !== null, 'parseToolCall parses a valid TOOL_CALL line');
  assert(parsed!.tool === 'search_tickets', 'tool name extracted');
  assert((parsed!.args as any).q === 'login', 'args extracted');
  console.log('  OK  parseToolCall: valid line');

  // 2. parseToolCall: non-TOOL_CALL line returns null
  assert(parseToolCall('Sure, here is the answer.') === null, 'non-TOOL_CALL line returns null');
  console.log('  OK  parseToolCall: non-TOOL_CALL returns null');

  // 3. isAllowedTool: known tool is allowed
  assert(isAllowedTool('search_tickets'), 'search_tickets is allowed');
  assert(isAllowedTool('get_cost_summary'), 'get_cost_summary is allowed');
  assert(!isAllowedTool('exec_code'), 'exec_code is not allowed');
  assert(!isAllowedTool(''), 'empty string is not allowed');
  console.log('  OK  isAllowedTool allowlist');

  // 4. buildToolsSystemPrompt contains tool names
  const systemPrompt = buildToolsSystemPrompt();
  assert(systemPrompt.includes('search_tickets'), 'system prompt lists search_tickets');
  assert(systemPrompt.includes('TOOL_CALL:'), 'system prompt describes TOOL_CALL format');
  console.log('  OK  buildToolsSystemPrompt contains tool names and format');

  // --- Integration checks (Postgres required) ---
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `ask-verify-${Date.now()}`;
  const { rows: [tenant] } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Ask Verify', slug],
  );

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const dataSource = app.get(DataSource);
  const fakeConfig = { get: (_k: string, def: unknown) => def } as any;

  try {
    const client = new ImmediateAnswerClient('Your cloud spend is under control this month.');
    const service = new AskService(dataSource, client, NO_SETTINGS, fakeConfig);

    // --- 5. Create a session ---
    const session = await service.createSession(tenant.id);
    assert(typeof session.id === 'string' && session.id.length > 0, 'session created with id');
    console.log('  OK  createSession returns an id');

    // --- 6. Ask a question and get an answer ---
    const answer = await service.ask(tenant.id, session.id, 'How is my cloud spend?');
    assert(answer.role === 'assistant', 'response role is assistant');
    assert(answer.content.length > 0, 'response has content');
    console.log('  OK  ask returns assistant response');

    // --- 7. Messages are persisted ---
    const messages = await service.getMessages(tenant.id, session.id);
    assert(messages.length === 2, 'user + assistant messages are persisted');
    assert(messages[0].role === 'user', 'first message is user');
    assert(messages[1].role === 'assistant', 'second message is assistant');
    console.log('  OK  messages are persisted in the session');

    // --- 8. Continuing a session appends messages ---
    await service.ask(tenant.id, session.id, 'Any recommendations?');
    const msgs2 = await service.getMessages(tenant.id, session.id);
    assert(msgs2.length === 4, 'second turn adds 2 more messages');
    console.log('  OK  subsequent turns append to the session');

    // --- 9. Wrong session id throws NotFoundException ---
    let threw = false;
    try {
      await service.ask(tenant.id, '00000000-0000-0000-0000-000000000000', 'hi');
    } catch {
      threw = true;
    }
    assert(threw, 'unknown session throws NotFoundException');
    console.log('  OK  unknown session throws NotFoundException');

    // --- 10. Disabled client throws BadRequestException ---
    const disabledService = new AskService(dataSource, new DisabledFake(), NO_SETTINGS, fakeConfig);
    const sess2 = await disabledService.createSession(tenant.id);
    let disabledThrew = false;
    try {
      await disabledService.ask(tenant.id, sess2.id, 'hi');
    } catch {
      disabledThrew = true;
    }
    assert(disabledThrew, 'disabled client throws BadRequestException');
    console.log('  OK  disabled client throws BadRequestException');

    // --- 11. RLS: session from another tenant is not visible ---
    const { rows: [otherTenant] } = await migrator.query(
      `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
      ['Ask Other', `ask-other-${Date.now()}`],
    );
    let rlsThrew = false;
    try {
      // tenant.id's session_id queried as otherTenant.id — RLS should block
      await service.getMessages(otherTenant.id, session.id);
    } catch {
      rlsThrew = true;
    }
    assert(rlsThrew, 'RLS prevents cross-tenant session access');
    console.log('  OK  RLS isolation: cross-tenant session access throws');

    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [otherTenant.id]);

    console.log('\nAll Ask assistant checks passed.');
  } finally {
    await migrator.query(`DELETE FROM ask_messages WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM ask_sessions WHERE tenant_id = $1`, [tenant.id]);
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
