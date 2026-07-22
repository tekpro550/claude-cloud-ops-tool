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

    // 5. Long conversation (>HISTORY_LIMIT messages): the responder must still
    //    see the newest visitor turn (regression guard for the ASC-LIMIT bug
    //    that took the OLDEST N messages).
    const [long] = await ds.query(
      `INSERT INTO chat_sessions (tenant_id, visitor_name, status, ai_enabled)
       VALUES ($1, 'Wordy', 'open', true) RETURNING id`,
      [T],
    );
    for (let i = 0; i < 14; i++) {
      await ds.query(
        `INSERT INTO chat_messages (tenant_id, chat_session_id, author_type, body, created_at)
         VALUES ($1, $2, $3, $4, now() - ($5 || ' seconds')::interval)`,
        [
          T,
          long.id,
          i % 2 === 0 ? 'visitor' : 'agent',
          `filler message ${i}`,
          200 - i,
        ],
      );
    }
    // Newest message is this fresh password question:
    await ds.query(
      `INSERT INTO chat_messages (tenant_id, chat_session_id, author_type, body)
       VALUES ($1, $2, 'visitor', 'I still need to reset my password please')`,
      [T, long.id],
    );
    const longFake = new FakeClient('Here is how to reset your password.');
    const longResponder = new (ChatAiResponderService as any)(
      ds,
      longFake,
      NO_SETTINGS,
      new (KbSearchService as any)(ds, new FakeClient('x'), NO_SETTINGS),
    );
    await longResponder.respond(T, long.id);
    const [longAi] = [
      await ds.query(
        `SELECT id FROM chat_messages WHERE chat_session_id = $1 AND author_type = 'ai'`,
        [long.id],
      ),
    ];
    assert.equal(
      longAi.length,
      1,
      'responder still answers past the history window',
    );
    assert(
      longFake.lastUser.includes('reset my password please'),
      'newest visitor turn (not the oldest N) reaches the AI prompt',
    );
    ok('responder handles a conversation longer than the history window');

    // 6. Mid-flight human claim: an agent grabs the session DURING the AI call,
    //    so the guarded INSERT matches 0 rows. This must not throw (regression
    //    guard for the INSERT-result destructuring) and must post no AI reply.
    const [race] = await ds.query(
      `INSERT INTO chat_sessions (tenant_id, visitor_name, status, ai_enabled)
       VALUES ($1, 'Racer', 'open', true) RETURNING id`,
      [T],
    );
    await ds.query(
      `INSERT INTO chat_messages (tenant_id, chat_session_id, author_type, body)
       VALUES ($1, $2, 'visitor', 'anyone there?')`,
      [T, race.id],
    );
    const claimDuringCall: AiCompletionClient = {
      enabled: true,
      async complete() {
        // Simulate a human agent claiming the session while the model runs.
        await ds.query(
          `UPDATE chat_sessions SET assigned_agent_id = $2 WHERE id = $1`,
          [race.id, agentId],
        );
        return 'A reply that should never be inserted.';
      },
    };
    const raceResponder = new (ChatAiResponderService as any)(
      ds,
      claimDuringCall,
      NO_SETTINGS,
      new (KbSearchService as any)(ds, new FakeClient('x'), NO_SETTINGS),
    );
    await raceResponder.respond(T, race.id); // must not throw
    const [raceAi] = [
      await ds.query(
        `SELECT id FROM chat_messages WHERE chat_session_id = $1 AND author_type = 'ai'`,
        [race.id],
      ),
    ];
    assert.equal(
      raceAi.length,
      0,
      'no AI reply when a human claims mid-flight (0-row insert handled)',
    );
    ok('mid-flight claim: 0-row insert is handled without error');

    // 7. KB search respects an empty AI re-rank (nothing genuinely relevant)
    //    instead of falling back to looser trigram matches.
    const emptyRerank = new (KbSearchService as any)(
      ds,
      {
        enabled: true,
        async complete() {
          return '[]';
        },
      } as AiCompletionClient,
      NO_SETTINGS,
    );
    const emptyHits = await emptyRerank.searchPublished(T, 'reset password', 3);
    assert.equal(
      emptyHits.length,
      0,
      'empty AI re-rank suppresses trigram fallback',
    );
    ok('KB search honors an empty AI re-rank result');

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
