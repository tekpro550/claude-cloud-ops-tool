import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import {
  AI_COMPLETION_CLIENT,
  AiCompletionClient,
} from '../../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../../ai/tenant-ai-settings.service';

const CLUSTER_LIMIT = 10;
const CLUSTER_THRESHOLD = 0.25;

export interface KbCluster {
  subject: string;
  ticket_ids: string[];
  ticket_count: number;
}

export interface KbDraftArticleDto {
  ticketIds: string[];
  agentId?: string;
}

export interface UpdateKbArticleDto {
  title?: string;
  bodyMd?: string;
  status?: 'draft' | 'published' | 'archived';
  tags?: string[];
}

@Injectable()
export class KbMiningService {
  private readonly logger = new Logger(KbMiningService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(AI_COMPLETION_CLIENT)
    private readonly envClient: AiCompletionClient,
    private readonly settings: TenantAiSettingsService,
  ) {}

  /**
   * Clusters resolved tickets by subject similarity using pg_trgm.
   * Returns groups of tickets that address the same problem — KB article candidates.
   */
  async suggestClusters(tenantId: string): Promise<KbCluster[]> {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      // Pull resolved tickets from the last 90 days
      const tickets: { id: string; subject: string }[] = await qr.query(
        `SELECT id, subject FROM tickets
         WHERE status IN ('resolved','closed')
           AND resolved_at >= now() - interval '90 days'
         ORDER BY resolved_at DESC
         LIMIT 500`,
      );
      if (tickets.length === 0) return [];

      // Simple greedy clustering by trigram similarity
      const clusters: KbCluster[] = [];
      const assigned = new Set<string>();

      for (const anchor of tickets) {
        if (assigned.has(anchor.id)) continue;
        const similar: { id: string }[] = await qr.query(
          `SELECT id FROM tickets
           WHERE id <> $1
             AND id <> ALL($3::uuid[])
             AND similarity(subject, $2) > $4
             AND status IN ('resolved','closed')
           LIMIT $5`,
          [
            anchor.id,
            anchor.subject,
            tickets.map((t) => t.id),
            CLUSTER_THRESHOLD,
            CLUSTER_LIMIT - 1,
          ],
        );
        if (similar.length === 0) continue; // singleton — not a cluster worth noting

        const members = [anchor.id, ...similar.map((s) => s.id)];
        members.forEach((id) => assigned.add(id));
        clusters.push({
          subject: anchor.subject,
          ticket_ids: members,
          ticket_count: members.length,
        });
        if (clusters.length >= 20) break; // cap at 20 clusters
      }
      return clusters;
    });
  }

  /**
   * Generates a KB article draft from a set of resolved tickets.
   * Digests their conversation transcripts and calls AI to write the article.
   */
  async draftArticle(tenantId: string, dto: KbDraftArticleDto) {
    if (!dto.ticketIds || dto.ticketIds.length === 0) {
      throw new BadRequestException('ticketIds must be a non-empty array');
    }

    const client =
      (await this.settings.resolveClient(tenantId)) ?? this.envClient;
    if (!client.enabled) {
      throw new BadRequestException(
        'AI assist is not configured for this tenant',
      );
    }

    const transcripts = await withTenantContext(
      this.dataSource,
      tenantId,
      async (qr) => {
        const results: string[] = [];
        for (const ticketId of dto.ticketIds.slice(0, 5)) {
          const [ticket] = await qr.query(
            `SELECT subject FROM tickets WHERE id = $1`,
            [ticketId],
          );
          if (!ticket) continue;
          const messages: { author_type: string; body: string }[] =
            await qr.query(
              `SELECT author_type, body FROM ticket_messages
               WHERE ticket_id = $1 ORDER BY created_at ASC LIMIT 10`,
              [ticketId],
            );
          const lines = [`=== Ticket: ${ticket.subject} ===`];
          for (const m of messages) {
            const who = m.author_type === 'contact' ? 'Customer' : 'Agent';
            lines.push(`${who}: ${m.body.replace(/<[^>]+>/g, ' ').trim()}`);
          }
          results.push(lines.join('\n'));
        }
        return results.join('\n\n');
      },
    );

    if (!transcripts) {
      throw new BadRequestException('No valid tickets found');
    }

    const system =
      'You are a technical writer creating a knowledge-base article. ' +
      'Given support ticket transcripts, write a clear, structured KB article in Markdown. ' +
      'Include: title (as # heading), problem description, step-by-step solution, and any tips. ' +
      'Return ONLY the Markdown content, starting with the # title.';

    let bodyMd: string;
    try {
      bodyMd = await client.complete(system, transcripts);
    } catch (err) {
      throw new BadRequestException(
        `AI draft failed: ${(err as Error).message}`,
      );
    }

    // Extract title from first # heading
    const titleMatch = bodyMd.match(/^#\s+(.+)/m);
    const title = titleMatch ? titleMatch[1].trim() : 'KB Article (draft)';

    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [article] = await qr.query(
        `INSERT INTO kb_articles
           (tenant_id, title, body_md, source_ticket_ids, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [tenantId, title, bodyMd, dto.ticketIds, dto.agentId ?? null],
      );
      return article;
    });
  }

  async list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (qr) =>
      qr.query(
        `SELECT id, title, status, tags, source_ticket_ids, created_at, updated_at
         FROM kb_articles ORDER BY updated_at DESC`,
      ),
    );
  }

  async get(tenantId: string, id: string) {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [row] = await qr.query(`SELECT * FROM kb_articles WHERE id = $1`, [
        id,
      ]);
      if (!row) throw new NotFoundException(`KB article ${id} not found`);
      return row;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateKbArticleDto) {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [existing] = await qr.query(
        `SELECT id FROM kb_articles WHERE id = $1`,
        [id],
      );
      if (!existing) throw new NotFoundException(`KB article ${id} not found`);

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (col: string, val: unknown) => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };
      if (dto.title !== undefined) assign('title', dto.title);
      if (dto.bodyMd !== undefined) assign('body_md', dto.bodyMd);
      if (dto.status !== undefined) assign('status', dto.status);
      if (dto.tags !== undefined) assign('tags', dto.tags);
      sets.push('updated_at = now()');
      params.push(id);

      const [updated] = await qr.query(
        `UPDATE kb_articles SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return updated;
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [row] = await qr.query(
        `DELETE FROM kb_articles WHERE id = $1 RETURNING id`,
        [id],
      );
      if (!row) throw new NotFoundException(`KB article ${id} not found`);
    });
  }
}
