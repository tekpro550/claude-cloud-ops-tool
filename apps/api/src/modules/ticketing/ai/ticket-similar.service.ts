import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import {
  AI_COMPLETION_CLIENT,
  AiCompletionClient,
} from '../../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../../ai/tenant-ai-settings.service';

const CANDIDATE_LIMIT = 20;
const TRGM_THRESHOLD = 0.15;

@Injectable()
export class TicketSimilarService {
  private readonly logger = new Logger(TicketSimilarService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(AI_COMPLETION_CLIENT)
    private readonly envClient: AiCompletionClient,
    private readonly settings: TenantAiSettingsService,
  ) {}

  /**
   * Returns the top similar tickets for `ticketId`. Uses pg_trgm to find
   * candidates, then optionally re-ranks them with AI if the client is enabled.
   */
  async getSimilar(
    tenantId: string,
    ticketId: string,
  ): Promise<Array<{ ticket_id: string; score: number; ai_ranked: boolean }>> {
    // 1. Fetch trigram candidates
    const candidates = await this.trgmCandidates(tenantId, ticketId);
    if (candidates.length === 0) return [];

    // 2. Optionally AI re-rank
    const client =
      (await this.settings.resolveClient(tenantId)) ?? this.envClient;
    if (!client.enabled) {
      // Return trgm results as-is, not AI-ranked
      return candidates.map((c) => ({
        ticket_id: c.similar_id,
        score: c.trgm_score,
        ai_ranked: false,
      }));
    }

    try {
      const ranked = await this.aiRerank(
        client,
        tenantId,
        ticketId,
        candidates,
      );
      // Persist for later retrieval
      await this.persistSuggestions(tenantId, ticketId, ranked, true);
      return ranked;
    } catch (err) {
      this.logger.warn(
        `AI re-rank failed for ticket ${ticketId}: ${(err as Error).message}`,
      );
      return candidates.map((c) => ({
        ticket_id: c.similar_id,
        score: c.trgm_score,
        ai_ranked: false,
      }));
    }
  }

  /** Return cached suggestions from last getSimilar call. */
  getCached(tenantId: string, ticketId: string) {
    return withTenantContext(this.dataSource, tenantId, (qr) =>
      qr.query(
        `SELECT similar_ticket_id AS ticket_id, score, ai_ranked
         FROM ticket_similar_suggestions
         WHERE ticket_id = $1
         ORDER BY score DESC
         LIMIT 10`,
        [ticketId],
      ),
    );
  }

  private async trgmCandidates(
    tenantId: string,
    ticketId: string,
  ): Promise<Array<{ similar_id: string; trgm_score: number }>> {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [src] = await qr.query(
        `SELECT subject FROM tickets WHERE id = $1`,
        [ticketId],
      );
      if (!src) return [];

      const rows: { id: string; sim: number }[] = await qr.query(
        `SELECT id, similarity(subject, $2) AS sim
         FROM tickets
         WHERE id <> $1
           AND status IN ('resolved','closed')
           AND similarity(subject, $2) > $3
         ORDER BY sim DESC
         LIMIT $4`,
        [ticketId, src.subject, TRGM_THRESHOLD, CANDIDATE_LIMIT],
      );
      return rows.map((r) => ({
        similar_id: r.id,
        trgm_score: Number(r.sim),
      }));
    });
  }

  private async aiRerank(
    client: AiCompletionClient,
    tenantId: string,
    ticketId: string,
    candidates: Array<{ similar_id: string; trgm_score: number }>,
  ): Promise<Array<{ ticket_id: string; score: number; ai_ranked: boolean }>> {
    const [source] = await withTenantContext(this.dataSource, tenantId, (qr) =>
      qr.query(`SELECT subject FROM tickets WHERE id = $1`, [ticketId]),
    );
    if (!source) return [];

    const candidateSubjects: { id: string; subject: string }[] =
      await withTenantContext(this.dataSource, tenantId, (qr) =>
        qr.query(`SELECT id, subject FROM tickets WHERE id = ANY($1::uuid[])`, [
          candidates.map((c) => c.similar_id),
        ]),
      );

    const idToSubject = new Map(
      candidateSubjects.map((c) => [c.id, c.subject]),
    );
    const list = candidates
      .map((c, i) => `${i}: ${idToSubject.get(c.similar_id) ?? '?'}`)
      .join('\n');

    const system =
      'You are a ticket similarity expert. Given a source ticket subject and a numbered list of candidate tickets, ' +
      'output ONLY a JSON array of objects: [{"index":0,"score":0.0-1.0},...] ' +
      'sorted by relevance descending. Score 1.0 = identical problem, 0.0 = unrelated. Output JSON only.';
    const user = `Source: ${source.subject}\n\nCandidates:\n${list}`;

    const raw = await client.complete(system, user);
    const json = raw.match(/\[[\s\S]*\]/)?.[0];
    if (!json) throw new Error('AI returned no JSON array');
    const ranked = JSON.parse(json) as Array<{ index: number; score: number }>;

    return ranked
      .filter(
        (r) =>
          Number.isInteger(r.index) &&
          r.index >= 0 &&
          r.index < candidates.length,
      )
      .map((r) => ({
        ticket_id: candidates[r.index].similar_id,
        score: Math.min(1, Math.max(0, Number(r.score))),
        ai_ranked: true,
      }));
  }

  private async persistSuggestions(
    tenantId: string,
    ticketId: string,
    suggestions: Array<{
      ticket_id: string;
      score: number;
      ai_ranked: boolean;
    }>,
    aiRanked: boolean,
  ): Promise<void> {
    await withTenantContext(this.dataSource, tenantId, async (qr) => {
      // Always clear old suggestions first — an empty re-rank means "nothing
      // is similar anymore", so stale rows must not survive for getCached.
      await qr.query(
        `DELETE FROM ticket_similar_suggestions WHERE ticket_id = $1`,
        [ticketId],
      );
      for (const s of suggestions) {
        await qr.query(
          `INSERT INTO ticket_similar_suggestions
             (tenant_id, ticket_id, similar_ticket_id, score, ai_ranked)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (ticket_id, similar_ticket_id) DO UPDATE
             SET score = EXCLUDED.score, ai_ranked = EXCLUDED.ai_ranked`,
          [tenantId, ticketId, s.ticket_id, s.score, aiRanked],
        );
      }
    });
  }
}
