import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import {
  AI_COMPLETION_CLIENT,
  AiCompletionClient,
} from '../../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../../ai/tenant-ai-settings.service';
import { LogsService, SearchLogsQuery } from './logs.service';

const ALLOWED_LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;

const NL_SYSTEM =
  "You are a log search assistant. Parse the user's natural-language log query into a JSON object with these optional fields: " +
  '{ "q": "full-text search phrase", "level": "error"|"warn"|"info"|"debug", ' +
  '"sourceName": "log source name", "fromRelative": "30m"|"1h"|"24h"|"7d"|"30d", "to": "ISO timestamp" }. ' +
  'Only include fields you can confidently extract. For "level", only use values from the allowed list. ' +
  'Output JSON only, no prose.';

@Injectable()
export class LogNlSearchService {
  private readonly logger = new Logger(LogNlSearchService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(AI_COMPLETION_CLIENT)
    private readonly envClient: AiCompletionClient,
    private readonly settings: TenantAiSettingsService,
    private readonly logs: LogsService,
  ) {}

  /**
   * Parses a natural-language query into structured log search parameters,
   * then executes the search and returns the results.
   */
  async nlSearch(
    tenantId: string,
    query: string,
  ): Promise<{ parsed: SearchLogsQuery; results: unknown[] }> {
    if (!query || query.trim().length === 0) {
      throw new BadRequestException('query must not be empty');
    }

    const client =
      (await this.settings.resolveClient(tenantId)) ?? this.envClient;
    if (!client.enabled) {
      throw new BadRequestException(
        'AI assist is not configured for this tenant',
      );
    }

    // Parse the NL query via AI
    let raw: string;
    try {
      raw = await client.complete(NL_SYSTEM, query);
    } catch (err) {
      throw new BadRequestException(
        `AI parse failed: ${(err as Error).message}`,
      );
    }

    const parsed = this.parseNlResult(raw);

    // Resolve sourceName → sourceId if provided
    if (parsed.sourceName) {
      const sourceId = await this.resolveSourceId(tenantId, parsed.sourceName);
      if (sourceId) {
        parsed.sourceId = sourceId;
      }
    }
    delete (parsed as { sourceName?: string }).sourceName;

    // Resolve fromRelative → from timestamp
    if (parsed.fromRelative) {
      parsed.from = this.resolveRelativeTime(parsed.fromRelative);
      delete (parsed as { fromRelative?: string }).fromRelative;
    }

    const results = await this.logs.search(tenantId, parsed);
    return { parsed, results };
  }

  private parseNlResult(raw: string): SearchLogsQuery & {
    sourceName?: string;
    fromRelative?: string;
  } {
    try {
      const json = raw.match(/\{[\s\S]*\}/)?.[0];
      if (!json) return {};
      const parsed = JSON.parse(json) as Record<string, unknown>;
      const result: SearchLogsQuery & {
        sourceName?: string;
        fromRelative?: string;
      } = {};

      if (typeof parsed.q === 'string' && parsed.q.trim()) {
        result.q = parsed.q.trim();
      }
      if (
        typeof parsed.level === 'string' &&
        (ALLOWED_LOG_LEVELS as readonly string[]).includes(parsed.level)
      ) {
        result.level = parsed.level;
      }
      if (typeof parsed.sourceName === 'string' && parsed.sourceName.trim()) {
        result.sourceName = parsed.sourceName.trim();
      }
      if (
        typeof parsed.fromRelative === 'string' &&
        /^\d+[mhd]$/.test(parsed.fromRelative)
      ) {
        result.fromRelative = parsed.fromRelative;
      }
      // Only accept a parseable timestamp — a malformed AI-produced value
      // would otherwise become a Postgres cast error (500) downstream.
      if (typeof parsed.to === 'string' && !isNaN(Date.parse(parsed.to))) {
        result.to = new Date(parsed.to).toISOString();
      }
      return result;
    } catch {
      return {};
    }
  }

  private async resolveSourceId(
    tenantId: string,
    sourceName: string,
  ): Promise<string | null> {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [row] = await qr.query(
        `SELECT id FROM log_sources WHERE lower(name) = lower($1) LIMIT 1`,
        [sourceName],
      );
      return row?.id ?? null;
    });
  }

  private resolveRelativeTime(relative: string): string {
    const match = relative.match(/^(\d+)([mhd])$/);
    if (!match) return new Date(Date.now() - 3600000).toISOString();
    const value = parseInt(match[1], 10);
    const unit = match[2];
    let ms = value * 1000;
    if (unit === 'm') ms *= 60;
    else if (unit === 'h') ms *= 3600;
    else if (unit === 'd') ms *= 86400;
    return new Date(Date.now() - ms).toISOString();
  }
}
