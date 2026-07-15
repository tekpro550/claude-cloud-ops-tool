import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { estimateMonthlySaving } from './cost-savings-estimate';
import {
  generateRightsizingReasonText,
  RightsizingRecommendationType,
} from './rightsizing-reason-text';

interface CloudMetricMonitorRow {
  monitor_id: string;
  resource_id: string;
  resource_name: string;
}

// "CPU averaged under 5% over 14 days" for idle is scope doc section 8's own
// suggested starting number (open decision #6, never overridden). 20% is a
// common rule-of-thumb rightsizing cutoff -- both are easy to move to tenant
// config later if real usage against tenant zero says otherwise (same
// "starting default, not a permanent constant" spirit as the pace
// warning/critical thresholds).
const IDLE_THRESHOLD_PCT = 5;
const RIGHTSIZE_THRESHOLD_PCT = 20;
const LOOKBACK_DAYS = 14;

/**
 * Module 3 Sprint 4's recommendation sweep (scope doc section 4/5) --
 * reads Module 2's existing monitor_checks utilization data for
 * 'cloud_metric' monitors rather than collecting its own metrics, the
 * concrete instance of "single data model across modules" the scope doc
 * calls out. Idempotent the same way CostPaceCheckService is: at most one
 * open recommendation per resource (enforced by the migration's partial
 * unique index), updated in place on a later sweep rather than duplicated,
 * and auto-resolved once utilization recovers.
 */
@Injectable()
export class RightsizingSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RightsizingSweepService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>(
      'RIGHTSIZING_SWEEP_INTERVAL_MS',
      21600000, // 6h -- utilization trends move slowly, no need for a tighter cadence
    );
    this.timer = setInterval(() => {
      void this.sweepOnce();
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweepOnce(): Promise<number> {
    if (this.running) {
      this.logger.warn(
        'rightsizing sweep already in progress, skipping this tick',
      );
      return 0;
    }
    this.running = true;
    try {
      const tenants = await this.dataSource.query(`SELECT id FROM tenants`);
      let count = 0;
      for (const tenant of tenants) {
        count += await this.sweepTenant(tenant.id);
      }
      return count;
    } finally {
      this.running = false;
    }
  }

  private async sweepTenant(tenantId: string): Promise<number> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const monitors: CloudMetricMonitorRow[] = await queryRunner.query(`
        SELECT m.id AS monitor_id, m.resource_id, r.name AS resource_name
        FROM monitors m
        JOIN resources r ON r.id = m.resource_id
        WHERE m.monitor_type = 'cloud_metric' AND m.is_enabled = true
      `);

      let count = 0;
      for (const monitor of monitors) {
        try {
          if (await this.evaluateMonitor(queryRunner, tenantId, monitor)) {
            count++;
          }
        } catch (err) {
          this.logger.error(
            `rightsizing evaluation for monitor ${monitor.monitor_id} failed: ${(err as Error).message}`,
          );
        }
      }
      return count;
    });
  }

  private async evaluateMonitor(
    queryRunner: QueryRunner,
    tenantId: string,
    monitor: CloudMetricMonitorRow,
  ): Promise<boolean> {
    const [row] = await queryRunner.query(
      `SELECT AVG((raw_output->>'value')::float) AS avg_value, COUNT(*)::int AS sample_count
       FROM monitor_checks
       WHERE monitor_id = $1 AND checked_at >= now() - interval '${LOOKBACK_DAYS} days'
         AND raw_output ? 'value'`,
      [monitor.monitor_id],
    );
    const sampleCount = row.sample_count as number;
    const avgValue = row.avg_value !== null ? Number(row.avg_value) : null;

    const [openRec] = await queryRunner.query(
      `SELECT id FROM rightsizing_recommendations WHERE resource_id = $1 AND status = 'open'`,
      [monitor.resource_id],
    );

    if (sampleCount === 0 || avgValue === null) {
      // Not enough data yet to judge -- leave any existing recommendation
      // alone rather than guessing.
      return false;
    }

    let recommendationType: RightsizingRecommendationType | null = null;
    if (avgValue < IDLE_THRESHOLD_PCT) recommendationType = 'idle';
    else if (avgValue < RIGHTSIZE_THRESHOLD_PCT)
      recommendationType = 'rightsize';

    if (!recommendationType) {
      if (openRec) {
        await queryRunner.query(
          `UPDATE rightsizing_recommendations SET status = 'resolved', updated_at = now() WHERE id = $1`,
          [openRec.id],
        );
      }
      return false;
    }

    const reasonText = generateRightsizingReasonText(
      monitor.resource_name,
      recommendationType,
      avgValue,
    );
    const estimatedSaving = await estimateMonthlySaving(
      queryRunner,
      monitor.resource_id,
      recommendationType,
    );

    if (!openRec) {
      await queryRunner.query(
        `INSERT INTO rightsizing_recommendations (tenant_id, resource_id, recommendation_type, reason_text, estimated_monthly_saving)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          tenantId,
          monitor.resource_id,
          recommendationType,
          reasonText,
          estimatedSaving,
        ],
      );
      return true;
    }

    await queryRunner.query(
      `UPDATE rightsizing_recommendations SET recommendation_type = $2, reason_text = $3, estimated_monthly_saving = $4, updated_at = now() WHERE id = $1`,
      [openRec.id, recommendationType, reasonText, estimatedSaving],
    );
    return true;
  }
}
