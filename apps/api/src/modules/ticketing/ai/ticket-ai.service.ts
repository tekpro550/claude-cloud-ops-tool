import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { htmlToPlainText } from '../sanitize-html';
import {
  AI_COMPLETION_CLIENT,
  AiCompletionClient,
} from './ai-completion.client';

export interface AiAssistResult {
  enabled: boolean;
  result?: string;
}

const SUMMARY_SYSTEM =
  'You are a support-desk assistant. Summarize the ticket conversation for an ' +
  'agent picking it up: the customer’s core problem, what has been tried, the ' +
  'current state, and the single most useful next step. Be concise — a short ' +
  'paragraph or a few bullet points. Do not invent details not in the thread.';

const REPLY_SYSTEM =
  'You are a support agent drafting the next reply to the customer. Write a ' +
  'professional, empathetic, ready-to-send response that addresses their latest ' +
  'message and moves the ticket forward. Do not include a subject line or ' +
  'placeholders like [name] — if you don’t know something, ask for it plainly. ' +
  'Return only the reply body.';

/**
 * AI assist for tickets (the review's "add AI" ask): summarize a thread and
 * draft a suggested reply. Backed by a pluggable completion client that is
 * disabled when no API key is configured, so every endpoint degrades to
 * {enabled:false} rather than erroring.
 */
@Injectable()
export class TicketAiService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(AI_COMPLETION_CLIENT)
    private readonly client: AiCompletionClient,
  ) {}

  status(): { enabled: boolean } {
    return { enabled: this.client.enabled };
  }

  async summarize(tenantId: string, ticketId: string): Promise<AiAssistResult> {
    if (!this.client.enabled) return { enabled: false };
    const transcript = await this.loadTranscript(tenantId, ticketId);
    const result = await this.client.complete(SUMMARY_SYSTEM, transcript);
    return { enabled: true, result };
  }

  async suggestReply(
    tenantId: string,
    ticketId: string,
  ): Promise<AiAssistResult> {
    if (!this.client.enabled) return { enabled: false };
    const transcript = await this.loadTranscript(tenantId, ticketId);
    const result = await this.client.complete(REPLY_SYSTEM, transcript);
    return { enabled: true, result };
  }

  /** Builds a plain-text transcript (subject + each message) for the prompt. */
  private loadTranscript(
    tenantId: string,
    ticketId: string,
  ): Promise<string> {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [ticket] = await qr.query(
        `SELECT subject FROM tickets WHERE id = $1`,
        [ticketId],
      );
      if (!ticket) {
        throw new NotFoundException(`Ticket ${ticketId} not found`);
      }
      const messages = await this.loadMessages(qr, ticketId);
      const lines = [`Subject: ${ticket.subject}`, ''];
      for (const m of messages) {
        const who =
          m.author_type === 'contact'
            ? 'Customer'
            : m.author_type === 'agent'
              ? 'Agent'
              : 'System';
        const kind = m.type === 'note' ? ' (internal note)' : '';
        lines.push(`${who}${kind}: ${htmlToPlainText(m.body)}`);
      }
      return lines.join('\n');
    });
  }

  private loadMessages(
    qr: QueryRunner,
    ticketId: string,
  ): Promise<Array<{ type: string; author_type: string; body: string }>> {
    return qr.query(
      `SELECT type, author_type, body FROM ticket_messages
       WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [ticketId],
    );
  }
}
