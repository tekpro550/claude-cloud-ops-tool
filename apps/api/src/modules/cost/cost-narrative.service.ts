import { createHash } from 'crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import {
  AI_COMPLETION_CLIENT,
  AiCompletionClient,
} from '../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../ai/tenant-ai-settings.service';

const NARRATIVE_SYSTEM =
  'You are a FinOps analyst. Given recent cloud cost anomalies and a month-end forecast, ' +
  'write a 2-4 sentence executive summary: what spiked, which services, and the projected impact. ' +
  'Be specific about dollar amounts and percentages. Return only the narrative, no JSON.';

@Injectable()
export class CostNarrativeService {
  private readonly logger = new Logger(CostNarrativeService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(AI_COMPLETION_CLIENT)
    private readonly envClient: AiCompletionClient,
    private readonly settings: TenantAiSettingsService,
  ) {}

  /**
   * Returns a cached or freshly generated AI narrative for the tenant's
   * current cost anomalies + forecast. The input is hashed so the same anomaly
   * set always returns the same cached narrative without re-calling the AI.
   */
  async getNarrative(
    tenantId: string,
    cloudCredentialId?: string,
  ): Promise<{ narrative: string; cached: boolean }> {
    const client =
      (await this.settings.resolveClient(tenantId)) ?? this.envClient;
    if (!client.enabled) {
      throw new BadRequestException(
        'AI assist is not configured for this tenant',
      );
    }

    const { anomalies, mtdSpend } = await this.loadContext(
      tenantId,
      cloudCredentialId,
    );

    // Hash the input for cache lookup
    const inputHash = createHash('sha256')
      .update(JSON.stringify({ anomalies, mtdSpend, cloudCredentialId }))
      .digest('hex');

    // Check cache
    const cached = await withTenantContext(
      this.dataSource,
      tenantId,
      async (qr) => {
        const [row] = await qr.query(
          `SELECT narrative FROM cost_narratives WHERE tenant_id = $1 AND input_hash = $2`,
          [tenantId, inputHash],
        );
        return row ?? null;
      },
    );

    if (cached) {
      return { narrative: cached.narrative as string, cached: true };
    }

    // Build prompt context
    const anomalyLines = anomalies
      .slice(0, 5)
      .map(
        (a: { service: string; amount: number; expected: number }) =>
          `- ${a.service}: $${Number(a.amount).toFixed(2)} (expected ~$${Number(a.expected).toFixed(2)})`,
      )
      .join('\n');

    const user = [
      `Month-to-date spend: $${Number(mtdSpend).toFixed(2)}`,
      anomalyLines
        ? `\nTop anomalies:\n${anomalyLines}`
        : '\nNo anomalies detected.',
    ].join('');

    let narrative: string;
    try {
      narrative = await client.complete(NARRATIVE_SYSTEM, user);
    } catch (err) {
      throw new BadRequestException(
        `AI narrative failed: ${(err as Error).message}`,
      );
    }

    // Store in cache
    await withTenantContext(this.dataSource, tenantId, async (qr) => {
      await qr.query(
        `INSERT INTO cost_narratives (tenant_id, input_hash, narrative, model)
         VALUES ($1, $2, $3, 'ai')
         ON CONFLICT (tenant_id, input_hash) DO NOTHING`,
        [tenantId, inputHash, narrative],
      );
    });

    return { narrative, cached: false };
  }

  private async loadContext(
    tenantId: string,
    cloudCredentialId?: string,
  ): Promise<{ anomalies: unknown[]; mtdSpend: number }> {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const credFilter = cloudCredentialId
        ? `AND cloud_credential_id = '${cloudCredentialId}'`
        : '';

      const [spendRow] = await qr.query(
        `SELECT COALESCE(SUM(amount),0)::float AS mtd
         FROM cost_line_items
         WHERE usage_date >= date_trunc('month', now())::date
           ${credFilter}`,
      );

      const anomalies = await qr.query(
        `SELECT service,
                SUM(CASE WHEN usage_date >= now() - interval '7 days' THEN amount ELSE 0 END)::float AS amount,
                AVG(amount)::float AS expected
         FROM cost_line_items
         WHERE usage_date >= now() - interval '30 days'
           ${credFilter}
         GROUP BY service
         HAVING SUM(CASE WHEN usage_date >= now() - interval '7 days' THEN amount ELSE 0 END)
              > 1.5 * AVG(amount) * 7
         ORDER BY amount DESC
         LIMIT 10`,
      );

      return {
        anomalies,
        mtdSpend: Number(spendRow?.mtd ?? 0),
      };
    });
  }
}
