import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import {
  anomalyReasonText,
  detectAnomaly,
  DEFAULT_ANOMALY_THRESHOLDS,
} from './cost-anomaly-detect';

const LOOKBACK_DAYS = 14;

interface ServiceDayRow {
  cloud_credential_id: string | null;
  service: string;
  region: string | null;
  usage_date: string;
  actual: number;
  baseline: number;
}

/**
 * Runs once per tenant after CostBillingSyncService finishes a sync, same
 * cadence as CostPaceCheckService. For the most recent complete usage day,
 * compares each (credential, service, region) group's spend against its
 * trailing 14-day mean and records an anomaly on a meaningful spike. Deduped
 * by the migration's unique index -- a re-sweep of the same day updates in
 * place rather than duplicating.
 */
@Injectable()
export class CostAnomalyCheckService {
  private readonly logger = new Logger(CostAnomalyCheckService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async checkTenant(tenantId: string): Promise<number> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      // The latest usage day we have data for, and each group's spend that
      // day plus its mean over the LOOKBACK_DAYS days before it.
      const rows: ServiceDayRow[] = await queryRunner.query(
        `WITH latest AS (
           SELECT max(usage_date) AS d FROM cost_line_items
         ),
         actual AS (
           SELECT cloud_credential_id, service, region, usage_date,
                  SUM(amount)::float AS actual
           FROM cost_line_items, latest
           WHERE usage_date = latest.d
           GROUP BY cloud_credential_id, service, region, usage_date
         ),
         baseline AS (
           SELECT cli.cloud_credential_id, cli.service, cli.region,
                  SUM(cli.amount)::float / $1 AS baseline
           FROM cost_line_items cli, latest
           WHERE cli.usage_date >= latest.d - ($1 || ' days')::interval
             AND cli.usage_date < latest.d
           GROUP BY cli.cloud_credential_id, cli.service, cli.region
         )
         SELECT a.cloud_credential_id, a.service, a.region, a.usage_date,
                a.actual, COALESCE(b.baseline, 0) AS baseline
         FROM actual a
         LEFT JOIN baseline b
           ON a.cloud_credential_id IS NOT DISTINCT FROM b.cloud_credential_id
          AND a.service = b.service
          AND a.region IS NOT DISTINCT FROM b.region`,
        [LOOKBACK_DAYS],
      );

      let recorded = 0;
      for (const row of rows) {
        const { isAnomaly, deviationPct } = detectAnomaly(
          row.baseline,
          row.actual,
          DEFAULT_ANOMALY_THRESHOLDS,
        );
        if (!isAnomaly) continue;

        const reason = anomalyReasonText(
          row.service,
          row.region,
          row.baseline,
          row.actual,
          deviationPct,
        );
        await queryRunner.query(
          `INSERT INTO cost_anomalies
             (tenant_id, cloud_credential_id, service, region, usage_date, baseline_amount, actual_amount, deviation_pct, reason_text)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (cloud_credential_id, service, COALESCE(region, ''), usage_date)
           DO UPDATE SET baseline_amount = EXCLUDED.baseline_amount,
                         actual_amount = EXCLUDED.actual_amount,
                         deviation_pct = EXCLUDED.deviation_pct,
                         reason_text = EXCLUDED.reason_text`,
          [
            tenantId,
            row.cloud_credential_id,
            row.service,
            row.region,
            row.usage_date,
            row.baseline,
            row.actual,
            deviationPct,
            reason,
          ],
        );
        recorded += 1;
      }
      return recorded;
    });
  }
}
