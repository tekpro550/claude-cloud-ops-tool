import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import {
  AI_COMPLETION_CLIENT,
  AiCompletionClient,
} from '../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../ai/tenant-ai-settings.service';

const RATIONALE_SYSTEM =
  'You are a cloud cost optimization expert. Given a rightsizing recommendation, ' +
  'write 2-3 sentences explaining the finding in plain English for an operations team. ' +
  'Include the resource name, why it qualifies for the recommendation, and the estimated saving. ' +
  'Be concrete and actionable. Return only the explanation, no headers or JSON.';

@Injectable()
export class RightsizingRationaleService {
  private readonly logger = new Logger(RightsizingRationaleService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(AI_COMPLETION_CLIENT) private readonly envClient: AiCompletionClient,
    private readonly settings: TenantAiSettingsService,
  ) {}

  /**
   * Called fire-and-forget from RightsizingSweepService after a recommendation
   * is upserted. Fills in ai_rationale on the recommendation row.
   */
  async generateRationale(
    tenantId: string,
    recommendationId: string,
  ): Promise<void> {
    try {
      const client =
        (await this.settings.resolveClient(tenantId)) ?? this.envClient;
      if (!client.enabled) return;

      const rec = await withTenantContext(
        this.dataSource,
        tenantId,
        async (qr) => {
          const [row] = await qr.query(
            `SELECT rr.id, rr.recommendation_type, rr.reason_text, rr.estimated_monthly_saving,
                    r.name AS resource_name
             FROM rightsizing_recommendations rr
             JOIN resources r ON r.id = rr.resource_id
             WHERE rr.id = $1`,
            [recommendationId],
          );
          return row ?? null;
        },
      );

      if (!rec) return;

      const user = [
        `Resource: ${rec.resource_name}`,
        `Type: ${rec.recommendation_type}`,
        `Current analysis: ${rec.reason_text}`,
        rec.estimated_monthly_saving !== null
          ? `Estimated monthly saving: $${Number(rec.estimated_monthly_saving).toFixed(2)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      let rationale: string;
      try {
        rationale = await client.complete(RATIONALE_SYSTEM, user);
      } catch (err) {
        this.logger.warn(
          `rationale AI call failed for recommendation ${recommendationId}: ${(err as Error).message}`,
        );
        return;
      }

      await withTenantContext(this.dataSource, tenantId, async (qr) => {
        await qr.query(
          `UPDATE rightsizing_recommendations
           SET ai_rationale = $2, ai_rationale_model = 'ai'
           WHERE id = $1`,
          [recommendationId, rationale.slice(0, 2000)],
        );
      });
    } catch (err) {
      this.logger.error(
        `rationale generation failed for recommendation ${recommendationId}: ${(err as Error).message}`,
      );
    }
  }
}
