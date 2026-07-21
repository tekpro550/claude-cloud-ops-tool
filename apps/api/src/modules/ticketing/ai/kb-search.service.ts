import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import {
  AI_COMPLETION_CLIENT,
  AiCompletionClient,
} from '../../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../../ai/tenant-ai-settings.service';

export interface KbSearchHit {
  id: string;
  title: string;
  score: number;
  ai_ranked: boolean;
  snippet: string;
}

const CANDIDATE_LIMIT = 12;
const TRGM_THRESHOLD = 0.1;
const DEFAULT_TOP_N = 3;

/**
 * Searches PUBLISHED knowledge-base articles for a free-text query. Uses
 * pg_trgm for candidates (index-backed by kb_articles_*_trgm), then optionally
 * re-ranks the top candidates with AI — same graceful-degradation shape as
 * TicketSimilarService: with no AI configured it returns the trigram order,
 * so KB search and portal deflection work with or without a provider.
 *
 * Shared by the portal deflection endpoint and the chat AI responder.
 */
@Injectable()
export class KbSearchService {
  private readonly logger = new Logger(KbSearchService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(AI_COMPLETION_CLIENT)
    private readonly envClient: AiCompletionClient,
    private readonly settings: TenantAiSettingsService,
  ) {}

  async searchPublished(
    tenantId: string,
    query: string,
    topN = DEFAULT_TOP_N,
  ): Promise<KbSearchHit[]> {
    const q = (query ?? '').trim();
    if (q.length === 0) return [];

    const candidates = await this.trgmCandidates(tenantId, q);
    if (candidates.length === 0) return [];

    const client =
      (await this.settings.resolveClient(tenantId)) ?? this.envClient;

    if (client.enabled) {
      try {
        const ranked = await this.aiRerank(client, q, candidates);
        if (ranked.length > 0) return ranked.slice(0, topN);
      } catch (err) {
        this.logger.warn(`KB AI re-rank failed: ${(err as Error).message}`);
      }
    }

    return candidates.slice(0, topN).map((c) => ({
      id: c.id,
      title: c.title,
      score: c.sim,
      ai_ranked: false,
      snippet: c.body_md
        .replace(/[#*`>]/g, '')
        .slice(0, 200)
        .trim(),
    }));
  }

  private trgmCandidates(tenantId: string, query: string) {
    return withTenantContext(this.dataSource, tenantId, (qr) =>
      qr.query(
        `SELECT id, title, body_md,
                GREATEST(similarity(title, $1), similarity(body_md, $1)) AS sim
         FROM kb_articles
         WHERE status = 'published'
           AND (title % $1 OR body_md % $1
                OR GREATEST(similarity(title, $1), similarity(body_md, $1)) > $2)
         ORDER BY sim DESC
         LIMIT $3`,
        [query, TRGM_THRESHOLD, CANDIDATE_LIMIT],
      ),
    ) as Promise<{ id: string; title: string; body_md: string; sim: number }[]>;
  }

  private async aiRerank(
    client: AiCompletionClient,
    query: string,
    candidates: { id: string; title: string; body_md: string }[],
  ): Promise<KbSearchHit[]> {
    const list = candidates.map((c, i) => `${i}: ${c.title}`).join('\n');
    const system =
      'You match a user question to the most relevant knowledge-base articles. ' +
      'Given the question and a numbered list of article titles, output ONLY a JSON ' +
      'array of objects [{"index":0,"score":0.0-1.0}], most relevant first, omitting ' +
      'articles that are not genuinely relevant. Output JSON only.';
    const user = `Question: ${query}\n\nArticles:\n${list}`;

    const raw = await client.complete(system, user);
    const json = raw.match(/\[[\s\S]*\]/)?.[0];
    if (!json) throw new Error('AI returned no JSON array');
    const ranked = JSON.parse(json) as { index: number; score: number }[];

    return ranked
      .filter(
        (r) =>
          Number.isInteger(r.index) &&
          r.index >= 0 &&
          r.index < candidates.length,
      )
      .map((r) => {
        const c = candidates[r.index];
        return {
          id: c.id,
          title: c.title,
          score: Math.min(1, Math.max(0, Number(r.score))),
          ai_ranked: true,
          snippet: c.body_md
            .replace(/[#*`>]/g, '')
            .slice(0, 200)
            .trim(),
        };
      });
  }
}
