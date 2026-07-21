import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import {
  AI_COMPLETION_CLIENT,
  AiCompletionClient,
} from '../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../ai/tenant-ai-settings.service';

const RECENT_CHECKS_LIMIT = 10;

const NARRATIVE_SYSTEM =
  'You are a site reliability engineer. Given an alert description and recent monitor check ' +
  'history, write a 2-3 sentence root cause analysis. Identify the likely cause, the pattern ' +
  'from the checks, and suggest the most important next diagnostic step. ' +
  'Be specific. Return only the narrative, no JSON, no bullet points.';

@Injectable()
export class AlertNarrativeService {
  private readonly logger = new Logger(AlertNarrativeService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(AI_COMPLETION_CLIENT)
    private readonly envClient: AiCompletionClient,
    private readonly settings: TenantAiSettingsService,
  ) {}

  /**
   * Called fire-and-forget from AlertEvaluationService after an alert is created.
   * Updates alerts.narrative with an AI-generated RCA.
   */
  async generateNarrative(tenantId: string, alertId: string): Promise<void> {
    try {
      const client =
        (await this.settings.resolveClient(tenantId)) ?? this.envClient;
      if (!client.enabled) return;

      const context = await this.loadContext(tenantId, alertId);
      if (!context) return;

      const checkLines = context.recentChecks
        .map(
          (c: {
            status: string;
            response_time_ms: number | null;
            checked_at: string;
          }) =>
            `  [${new Date(c.checked_at).toISOString()}] status=${c.status}${
              c.response_time_ms !== null
                ? `, response_time=${c.response_time_ms}ms`
                : ''
            }`,
        )
        .join('\n');

      const user = [
        `Monitor: ${context.monitorName} (${context.monitorType})`,
        `Alert: ${context.reasonText}`,
        context.recentChecks.length > 0
          ? `\nRecent checks (newest first):\n${checkLines}`
          : '\nNo recent checks available.',
      ].join('');

      let narrative: string;
      try {
        narrative = await client.complete(NARRATIVE_SYSTEM, user);
      } catch (err) {
        this.logger.warn(
          `narrative AI call failed for alert ${alertId}: ${(err as Error).message}`,
        );
        return;
      }

      await withTenantContext(this.dataSource, tenantId, async (qr) => {
        await qr.query(
          `UPDATE alerts
           SET narrative = $2, narrative_model = 'ai', narrative_generated_at = now()
           WHERE id = $1`,
          [alertId, narrative.slice(0, 5000)],
        );
      });
    } catch (err) {
      this.logger.error(
        `narrative generation failed for alert ${alertId}: ${(err as Error).message}`,
      );
    }
  }

  private async loadContext(tenantId: string, alertId: string) {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [alert] = await qr.query(
        `SELECT a.id, a.reason_text, a.monitor_id,
                m.name AS monitor_name, m.monitor_type
         FROM alerts a
         JOIN monitors m ON m.id = a.monitor_id
         WHERE a.id = $1`,
        [alertId],
      );
      if (!alert) return null;

      const recentChecks = await qr.query(
        `SELECT status, response_time_ms, checked_at
         FROM monitor_checks
         WHERE monitor_id = $1
         ORDER BY checked_at DESC
         LIMIT $2`,
        [alert.monitor_id, RECENT_CHECKS_LIMIT],
      );

      return {
        monitorName: alert.monitor_name as string,
        monitorType: alert.monitor_type as string,
        reasonText: alert.reason_text as string,
        recentChecks,
      };
    });
  }
}
