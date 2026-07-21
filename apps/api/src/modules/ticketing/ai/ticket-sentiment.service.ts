import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import {
  AI_COMPLETION_CLIENT,
  AiCompletionClient,
} from '../../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../../ai/tenant-ai-settings.service';

const SENTIMENT_LABELS = [
  'positive',
  'neutral',
  'negative',
  'at_risk',
] as const;
type SentimentLabel = (typeof SENTIMENT_LABELS)[number];

/** Minimum gap between sentiment re-evaluations for the same ticket (ms). */
const MIN_SENTIMENT_GAP_MS = 5 * 60 * 1000; // 5 minutes

const SENTIMENT_SYSTEM =
  'You are a customer-sentiment analyst. Given a support ticket conversation, ' +
  'output ONLY valid JSON: ' +
  '{"sentiment":"positive"|"neutral"|"negative"|"at_risk","score":0.0–1.0,"rationale":"one sentence"}. ' +
  '"at_risk" means the customer shows churn signals (frustration, deadline, escalation threat). ' +
  'Score is confidence 0–1. Output JSON only, no prose.';

@Injectable()
export class TicketSentimentService {
  private readonly logger = new Logger(TicketSentimentService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(AI_COMPLETION_CLIENT)
    private readonly envClient: AiCompletionClient,
    private readonly settings: TenantAiSettingsService,
  ) {}

  /**
   * Called fire-and-forget from TicketsService.addMessage whenever an inbound
   * customer message is added. Debounces per ticket so rapid message bursts
   * don't spam the AI provider.
   */
  async detectSentiment(tenantId: string, ticketId: string): Promise<void> {
    try {
      const client =
        (await this.settings.resolveClient(tenantId)) ?? this.envClient;
      if (!client.enabled) return;

      // Debounce via an atomic claim: only the caller whose UPDATE matches
      // gets to run the AI, so two near-simultaneous inbound messages can't
      // both pass a read-then-act check and double-call the provider. The
      // timestamp is consumed even if the AI call then fails — that's
      // deliberate back-off against a failing provider.
      const claimed = await withTenantContext(
        this.dataSource,
        tenantId,
        async (qr) => {
          // UPDATE ... RETURNING comes back as [rows, affectedCount]
          const [rows] = await qr.query(
            `UPDATE tickets SET sentiment_updated_at = now()
             WHERE id = $1
               AND (sentiment_updated_at IS NULL
                    OR sentiment_updated_at < now() - ($2 || ' milliseconds')::interval)
             RETURNING id`,
            [ticketId, MIN_SENTIMENT_GAP_MS],
          );
          return rows.length > 0;
        },
      );
      if (!claimed) return;

      const transcript = await this.loadTranscript(tenantId, ticketId);
      if (!transcript) return;

      let raw: string;
      try {
        raw = await client.complete(SENTIMENT_SYSTEM, transcript);
      } catch (err) {
        this.logger.warn(
          `sentiment AI call failed for ticket ${ticketId}: ${(err as Error).message}`,
        );
        return;
      }

      const parsed = this.parseSentiment(raw);
      if (!parsed) return;

      await withTenantContext(this.dataSource, tenantId, async (qr) => {
        await qr.query(
          `UPDATE tickets
           SET sentiment = $2, sentiment_score = $3, sentiment_updated_at = now()
           WHERE id = $1`,
          [ticketId, parsed.sentiment, parsed.score],
        );
      });
    } catch (err) {
      this.logger.error(
        `sentiment detection failed for ticket ${ticketId}: ${(err as Error).message}`,
      );
    }
  }

  private async loadTranscript(
    tenantId: string,
    ticketId: string,
  ): Promise<string | null> {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [ticket] = await qr.query(
        `SELECT subject FROM tickets WHERE id = $1`,
        [ticketId],
      );
      if (!ticket) return null;
      const messages: { author_type: string; body: string }[] = await qr.query(
        `SELECT author_type, body FROM ticket_messages
           WHERE ticket_id = $1 ORDER BY created_at ASC LIMIT 20`,
        [ticketId],
      );
      const lines = [`Subject: ${ticket.subject}`, ''];
      for (const m of messages) {
        const who = m.author_type === 'contact' ? 'Customer' : 'Agent';
        lines.push(`${who}: ${m.body.replace(/<[^>]+>/g, ' ').trim()}`);
      }
      return lines.join('\n');
    });
  }

  private parseSentiment(
    raw: string,
  ): { sentiment: SentimentLabel; score: number } | null {
    try {
      const json = raw.match(/\{[\s\S]*\}/)?.[0];
      if (!json) return null;
      const parsed = JSON.parse(json) as Record<string, unknown>;
      const sentiment = parsed.sentiment as string;
      if (!(SENTIMENT_LABELS as readonly string[]).includes(sentiment))
        return null;
      const score = Number(parsed.score);
      if (isNaN(score) || score < 0 || score > 1) return null;
      return { sentiment: sentiment as SentimentLabel, score };
    } catch {
      return null;
    }
  }
}
