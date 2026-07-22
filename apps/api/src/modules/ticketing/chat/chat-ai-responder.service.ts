import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import {
  AI_COMPLETION_CLIENT,
  AiCompletionClient,
} from '../../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../../ai/tenant-ai-settings.service';
import { KbSearchService } from '../ai/kb-search.service';

const HISTORY_LIMIT = 12;

const RESPONDER_SYSTEM =
  'You are a friendly first-line support assistant in a live chat widget. Answer the ' +
  "visitor's question concisely (2-4 sentences) using ONLY the knowledge-base excerpts " +
  'provided. If the excerpts do not answer the question, say you will connect them with a ' +
  'human agent and ask a clarifying question. Never invent policies, prices, or facts not ' +
  'in the excerpts. Plain text only.';

/**
 * AI first-responder for native chat. Fired fire-and-forget from
 * ChatService.addMessage on a visitor turn. It only speaks while the session
 * is unclaimed: the moment a human agent replies (assigned_agent_id is set) or
 * the session's ai_enabled flag is off, it goes silent — that is the handoff.
 * Answers are grounded in published KB articles via KbSearchService.
 */
@Injectable()
export class ChatAiResponderService {
  private readonly logger = new Logger(ChatAiResponderService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(AI_COMPLETION_CLIENT)
    private readonly envClient: AiCompletionClient,
    private readonly settings: TenantAiSettingsService,
    private readonly kbSearch: KbSearchService,
  ) {}

  async respond(tenantId: string, sessionId: string): Promise<void> {
    try {
      const client =
        (await this.settings.resolveClient(tenantId)) ?? this.envClient;
      if (!client.enabled) return;

      const ctx = await this.loadContext(tenantId, sessionId);
      // Silent unless the session is open, AI-enabled, and still unclaimed by
      // a human — that claim check is the handoff.
      if (!ctx) return;
      if (
        ctx.status !== 'open' ||
        !ctx.aiEnabled ||
        ctx.assignedAgentId !== null
      )
        return;

      const lastVisitor = [...ctx.messages]
        .reverse()
        .find((m) => m.author_type === 'visitor');
      if (!lastVisitor) return;

      // Don't answer twice in a row: if an AI message already follows the last
      // visitor message, wait for the next visitor turn.
      const lastIdx = ctx.messages.lastIndexOf(lastVisitor);
      if (ctx.messages.slice(lastIdx + 1).some((m) => m.author_type === 'ai'))
        return;

      const hits = await this.kbSearch.searchPublished(
        tenantId,
        lastVisitor.body,
        3,
      );
      const kbBlock =
        hits.length > 0
          ? hits
              .map((h, i) => `[Article ${i + 1}: ${h.title}]\n${h.snippet}`)
              .join('\n\n')
          : '(No relevant knowledge-base articles found.)';

      const transcript = ctx.messages
        .map(
          (m) =>
            `${m.author_type === 'visitor' ? 'Visitor' : m.author_type === 'ai' ? 'Assistant' : 'Agent'}: ${m.body}`,
        )
        .join('\n');

      const user = `Knowledge base excerpts:\n${kbBlock}\n\nConversation so far:\n${transcript}\n\nWrite the assistant's next reply.`;

      let reply: string;
      try {
        reply = (await client.complete(RESPONDER_SYSTEM, user)).trim();
      } catch (err) {
        this.logger.warn(
          `chat AI reply failed for session ${sessionId}: ${(err as Error).message}`,
        );
        return;
      }
      if (!reply) return;

      // Re-check atomically inside the write transaction. A transaction-scoped
      // advisory lock on the session serializes concurrent responders (two
      // near-simultaneous visitor turns each spawn a respond()), and the INSERT
      // is gated on three conditions evaluated under that lock:
      //   - the session is still open, ai_enabled, and unclaimed (human handoff
      //     always wins — a late agent claim suppresses the reply), and
      //   - the newest message is still a visitor turn, so a responder that
      //     already answered (or a human/AI reply that landed first) blocks a
      //     duplicate AI reply.
      // INSERT ... RETURNING returns the rows array directly (unlike UPDATE,
      // which returns [rows, count]) — do not destructure it.
      await withTenantContext(this.dataSource, tenantId, async (qr) => {
        await qr.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          sessionId,
        ]);
        const rows = await qr.query(
          `INSERT INTO chat_messages (tenant_id, chat_session_id, author_type, body)
           SELECT $1, $2, 'ai', $3
           WHERE EXISTS (
             SELECT 1 FROM chat_sessions
             WHERE id = $2 AND status = 'open'
               AND ai_enabled = true AND assigned_agent_id IS NULL
           )
           AND (
             SELECT author_type FROM chat_messages
             WHERE chat_session_id = $2
             ORDER BY created_at DESC LIMIT 1
           ) = 'visitor'
           RETURNING id`,
          [tenantId, sessionId, reply.slice(0, 4000)],
        );
        if (rows.length > 0) {
          await qr.query(
            `UPDATE chat_sessions SET last_message_at = now() WHERE id = $1`,
            [sessionId],
          );
        }
      });
    } catch (err) {
      this.logger.error(
        `chat AI responder failed for session ${sessionId}: ${(err as Error).message}`,
      );
    }
  }

  private loadContext(tenantId: string, sessionId: string) {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [session] = await qr.query(
        `SELECT status, ai_enabled, assigned_agent_id FROM chat_sessions WHERE id = $1`,
        [sessionId],
      );
      if (!session) return null;
      // Newest HISTORY_LIMIT messages, replayed chronologically — a plain
      // ASC LIMIT would keep the OLDEST N and miss the visitor's latest turn
      // once the conversation grows past the window.
      const messages: { author_type: string; body: string }[] = await qr.query(
        `SELECT author_type, body FROM (
           SELECT author_type, body, created_at FROM chat_messages
           WHERE chat_session_id = $1
           ORDER BY created_at DESC
           LIMIT $2
         ) latest
         ORDER BY created_at ASC`,
        [sessionId, HISTORY_LIMIT],
      );
      return {
        status: session.status as string,
        aiEnabled: session.ai_enabled as boolean,
        assignedAgentId: session.assigned_agent_id as string | null,
        messages,
      };
    });
  }
}
