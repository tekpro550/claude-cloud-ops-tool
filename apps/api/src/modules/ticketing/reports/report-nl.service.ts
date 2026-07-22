import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  AI_COMPLETION_CLIENT,
  AiCompletionClient,
} from '../../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../../ai/tenant-ai-settings.service';
import {
  buildReportQuery,
  DATE_FIELDS,
  DIMENSIONS,
  FILTER_FIELDS,
  METRICS,
  ReportConfig,
} from './report-builder';

const NL_SYSTEM =
  'You translate a plain-English analytics question about support tickets into a ' +
  'JSON report configuration. Output ONLY JSON of this exact shape:\n' +
  '{ "metric": one of [' +
  METRICS.map((m) => `"${m}"`).join(',') +
  '],\n' +
  '  "groupBy": one of [' +
  DIMENSIONS.map((d) => `"${d}"`).join(',') +
  '],\n' +
  '  "filters": [{"field": one of [' +
  FILTER_FIELDS.map((f) => `"${f}"`).join(',') +
  '], "value": "string"}] (optional),\n' +
  '  "dateField": one of [' +
  DATE_FIELDS.map((d) => `"${d}"`).join(',') +
  '] (optional),\n' +
  '  "dateRange": {"from":"YYYY-MM-DD","to":"YYYY-MM-DD"} (optional) }\n' +
  'Ticket statuses are new/open/pending/resolved/closed and priorities are ' +
  'low/medium/high/urgent. Pick the single metric and groupBy that best answer the ' +
  'question. Output JSON only, no prose, no markdown fences.';

/**
 * Natural-language front door to the custom report builder. The AI only ever
 * proposes a ReportConfig — the returned config is re-validated by running it
 * through buildReportQuery(), the exact same allowlist gate the saved-report
 * path uses, so a hallucinated metric/dimension/filter token throws
 * BadRequestException before any SQL is executed. The endpoint returns the
 * config as a preview draft; nothing is persisted here.
 */
@Injectable()
export class ReportNlService {
  constructor(
    @Inject(AI_COMPLETION_CLIENT)
    private readonly envClient: AiCompletionClient,
    private readonly settings: TenantAiSettingsService,
  ) {}

  async buildConfig(tenantId: string, question: string): Promise<ReportConfig> {
    if (!question || question.trim().length === 0) {
      throw new BadRequestException('question must not be empty');
    }
    if (question.length > 2000) {
      throw new BadRequestException('question must be at most 2000 characters');
    }

    const client =
      (await this.settings.resolveClient(tenantId)) ?? this.envClient;
    if (!client.enabled) {
      throw new BadRequestException(
        'AI assist is not configured for this tenant',
      );
    }

    let raw: string;
    try {
      raw = await client.complete(NL_SYSTEM, question);
    } catch (err) {
      throw new BadRequestException(
        `AI parse failed: ${(err as Error).message}`,
      );
    }

    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!json) {
      throw new BadRequestException(
        'AI did not return a valid JSON report config. Try rephrasing.',
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(json) as Record<string, unknown>;
    } catch {
      throw new BadRequestException(
        'AI returned malformed JSON. Try rephrasing.',
      );
    }

    const config = this.coerce(parsed);

    // The real gate: run the proposed config through the same builder the
    // saved-report path uses. An unrecognized token throws here, before any
    // query is ever built or run.
    try {
      buildReportQuery(config);
    } catch (err) {
      throw new BadRequestException(
        `AI-generated report config failed validation: ${(err as Error).message}. ` +
          'Try rephrasing the question.',
      );
    }

    return config;
  }

  private coerce(parsed: Record<string, unknown>): ReportConfig {
    const config: ReportConfig = {
      metric: String(parsed.metric) as ReportConfig['metric'],
      groupBy: String(parsed.groupBy) as ReportConfig['groupBy'],
    };
    if (Array.isArray(parsed.filters)) {
      config.filters = parsed.filters
        .filter(
          (f): f is Record<string, unknown> =>
            !!f &&
            typeof f === 'object' &&
            typeof (f as any).value === 'string',
        )
        .map((f) => ({
          field: String(f.field) as ReportConfig['groupBy'],
          value: String(f.value).slice(0, 500),
        }));
    }
    if (typeof parsed.dateField === 'string') {
      config.dateField = parsed.dateField as ReportConfig['dateField'];
    }
    if (
      parsed.dateRange &&
      typeof parsed.dateRange === 'object' &&
      typeof (parsed.dateRange as any).from === 'string' &&
      typeof (parsed.dateRange as any).to === 'string'
    ) {
      const dr = parsed.dateRange as { from: string; to: string };
      if (!isNaN(Date.parse(dr.from)) && !isNaN(Date.parse(dr.to))) {
        config.dateRange = { from: dr.from, to: dr.to };
      }
    }
    return config;
  }
}
