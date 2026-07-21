/**
 * End-to-end verify for the chat AI first-responder + KB deflection search.
 * Requires Postgres. Uses a fake AI client — no real provider.
 */
import 'reflect-metadata';
import * as assert from 'assert';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../../../../database/data-source';
import { AiCompletionClient } from '../../../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../../../ai/tenant-ai-settings.service';

const T = 'eeeeeeee-0000-0000-0000-000000000001';

const NO_SETTINGS = {
  resolveClient: async () => null,
} as unknown as TenantAiSettingsService;

class FakeClient implements AiCompletionClient {
  readonly enabled = true;
  calls = 0;
  constructor(private readonly reply: string) {}
  async complete(_s: string, user: string): Promise<string> {
    this.calls++;
    this.lastUser = user;
    // KB re-rank asks for a JSON array; the chat reply asks for prose.
    if (user.includes('Articles:')) return '[{"index":0,"score":0.95}]';
    return this.reply;
  }
  lastUser = '';
}

function ok(m: string) {
  console.log(`  OK  ${m}`);
}

async function seed(ds: DataSource) {
  await ds.query(`DELETE FROM tenants WHERE id = $1`, [T]);
  await ds.query(
    `INSERT INTO tenants (id, name, slug) VALUES ($1, 'Chat AI Verify', 'chat-ai-verify')`,
    [T],
  );
  await ds.query(
    `INSERT INTO kb_articles (tenant_id, title, body_md, status)
     VALUES ($1, 'Resetting your password', 'Go to Settings, click Reset Password, and follow the emailed link to choose a new password.', 'published'),
            ($1, 'Draft internal runbook', 'Not for customers.', 'draft')`,
    [T],
  );
  // A real agent to model the human-handoff claim (FK-backed).
  const [user] = await ds.query(
    `INSERT INTO users (tenant_id, email, name, password_hash, role)
     VALUES ($1, 'agent@chat-ai-verify.test', 'Agent', 'x', 'agent') RETURNING id`,
    [T],
  );
  const [agent] = await ds.query(
    `INSERT INTO agents (tenant_id, user_id) VALUES ($1, $2) RETURNING id`,
    [T, user.id],
  );
  return agent.id as string;
}

async function main() {
  const ds = AppDataSource;
  await ds.initialize();
  try {
    const agentId = await seed(ds);
    const { KbSearchService } = await import('../../ai/kb-search.service');
    const { ChatAiResponderService } =
      await import('../chat-ai-responder.service');

    // --- KB deflection search: only published articles, ranked ---
    const kbFake = new FakeClient('unused');
    const kbSearch = new (KbSearchService as any)(ds, kbFake, NO_SETTINGS);
    const hits = await kbSearch.searchPublished(
      T,
      'how do I reset my password',
      3,
    );
    assert(hits.length >= 1, 'KB search returns a hit');
    assert(
      hits[0].title === 'Resetting your password',
      'top hit is the relevant published article',
    );
    assert(
      !hits.some((h: any) => h.title.includes('internal runbook')),
      'draft articles are never returned',
    );
    ok('KB deflection returns only published, relevant articles');

    // --- Chat responder: seed an open, unclaimed, AI-enabled session ---
    const [session] = await ds.query(
      `INSERT INTO chat_sessions (tenant_id, visitor_name, status, ai_enabled)
       VALUES ($1, 'Sam', 'open', true) RETURNING id`,
      [T],
    );
    await ds.query(
      `INSERT INTO chat_messages (tenant_id, chat_session_id, author_type, body)
       VALUES ($1, $2, 'visitor', 'I forgot my password, how do I reset it?')`,
      [T, session.id],
    );

    const chatFake = new FakeClient(
      'You can reset it from Settings → Reset Password; a link will be emailed to you.',
    );
    const responder = new (ChatAiResponderService as any)(
      ds,
      chatFake,
      NO_SETTINGS,
      new (KbSearchService as any)(ds, new FakeClient('x'), NO_SETTINGS),
    );

    // 1. Unclaimed session → AI answers, grounded in the KB excerpt
    await responder.respond(T, session.id);
    let [msgs] = [
      await ds.query(
        `SELECT author_type, body FROM chat_messages WHERE chat_session_id = $1 ORDER BY created_at ASC`,
        [session.id],
      ),
    ];
    const aiMsg = msgs.find((m: any) => m.author_type === 'ai');
    assert(!!aiMsg, 'AI posts a reply on an unclaimed session');
    assert(
      chatFake.lastUser.includes('Resetting your password'),
      'AI reply is grounded in KB context',
    );
    ok('AI first-responder answers an unclaimed session using KB context');

    // 2. No double-answer: responding again without a new visitor turn is a no-op
    const before = msgs.length;
    await responder.respond(T, session.id);
    [msgs] = [
      await ds.query(
        `SELECT id FROM chat_messages WHERE chat_session_id = $1`,
        [session.id],
      ),
    ];
    assert.equal(
      msgs.length,
      before,
      'no second AI reply without a new visitor turn',
    );
    ok('AI does not answer twice in a row');

    // 3. Handoff: once a human agent replies, the session is claimed and the
    //    AI goes silent even on a fresh visitor turn.
    await ds.query(
      `UPDATE chat_sessions SET assigned_agent_id = $2 WHERE id = $1`,
      [session.id, agentId],
    );
    await ds.query(
      `INSERT INTO chat_messages (tenant_id, chat_session_id, author_type, body)
       VALUES ($1, $2, 'visitor', 'are you a robot?')`,
      [T, session.id],
    );
    const claimedCalls = chatFake.calls;
    await responder.respond(T, session.id);
    assert.equal(
      chatFake.calls,
      claimedCalls,
      'AI makes no call once a human has claimed the session',
    );
    ok('AI stays silent after human agent handoff');

    // 4. ai_enabled = false suppresses the responder
    const [off] = await ds.query(
      `INSERT INTO chat_sessions (tenant_id, visitor_name, status, ai_enabled)
       VALUES ($1, 'Nef', 'open', false) RETURNING id`,
      [T],
    );
    await ds.query(
      `INSERT INTO chat_messages (tenant_id, chat_session_id, author_type, body)
       VALUES ($1, $2, 'visitor', 'reset password?')`,
      [T, off.id],
    );
    await responder.respond(T, off.id);
    const [offMsgs] = [
      await ds.query(
        `SELECT id FROM chat_messages WHERE chat_session_id = $1 AND author_type = 'ai'`,
        [off.id],
      ),
    ];
    assert.equal(offMsgs.length, 0, 'ai_enabled=false produces no AI reply');
    ok('ai_enabled=false disables the responder');

    console.log('\nAll chat-ai + kb-deflection checks passed.');
  } finally {
    await ds.query(`DELETE FROM tenants WHERE id = $1`, [T]).catch(() => {});
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
