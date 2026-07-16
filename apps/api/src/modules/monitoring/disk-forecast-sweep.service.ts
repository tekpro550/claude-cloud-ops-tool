import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { DiskSample, forecastDaysToFull } from './disk-forecast';

const HORIZON_DAYS = 14;
const LOOKBACK_DAYS = 7;

/**
 * Projects when server-agent disks will fill and records a forecast when
 * one is within HORIZON_DAYS. Same sweep shape as OverdueSweepService /
 * TimeAutomationSweepService (interval + unref + a runSweepOnce() exposed
 * for deterministic testing). Reuses Module 2's existing monitor_checks
 * disk metrics rather than collecting its own, and dedupes via the unique
 * index on disk_forecasts.monitor_id.
 */
@Injectable()
export class DiskForecastSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DiskForecastSweepService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>(
      'DISK_FORECAST_SWEEP_INTERVAL_MS',
      3600000,
    );
    this.timer = setInterval(() => {
      void this.runSweepOnce();
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runSweepOnce(): Promise<number> {
    if (this.running) {
      this.logger.warn('sweep already in progress, skipping this tick');
      return 0;
    }
    this.running = true;
    try {
      const tenants = await this.dataSource.query(`SELECT id FROM tenants`);
      let recorded = 0;
      for (const tenant of tenants)
        recorded += await this.sweepTenant(tenant.id);
      return recorded;
    } finally {
      this.running = false;
    }
  }

  private async sweepTenant(tenantId: string): Promise<number> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const monitors: Array<{
        id: string;
        resource_id: string | null;
        name: string;
      }> = await queryRunner.query(
        `SELECT id, resource_id, name FROM monitors WHERE monitor_type = 'server_agent'`,
      );

      let recorded = 0;
      for (const monitor of monitors) {
        const rows = await queryRunner.query(
          `SELECT checked_at, (raw_output->>'diskPercent')::float AS disk
           FROM monitor_checks
           WHERE monitor_id = $1
             AND raw_output ? 'diskPercent'
             AND checked_at >= now() - ($2 || ' days')::interval
           ORDER BY checked_at ASC`,
          [monitor.id, LOOKBACK_DAYS],
        );
        const samples: DiskSample[] = rows
          .filter((r: { disk: number | null }) => r.disk !== null)
          .map((r: { checked_at: string; disk: number }) => ({
            t: new Date(r.checked_at).getTime(),
            value: r.disk,
          }));

        const forecast = forecastDaysToFull(samples);
        if (!forecast || forecast.daysToFull > HORIZON_DAYS) {
          // No longer projected to fill within the horizon -- clear any
          // stale open forecast.
          await queryRunner.query(
            `DELETE FROM disk_forecasts WHERE monitor_id = $1`,
            [monitor.id],
          );
          continue;
        }

        const reason = `${monitor.name} disk projected full in ~${forecast.daysToFull} days (now ${forecast.currentPct}%, +${forecast.ratePerDay}%/day).`;
        await queryRunner.query(
          `INSERT INTO disk_forecasts
             (tenant_id, monitor_id, resource_id, current_pct, rate_per_day, days_to_full, reason_text, status, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', now())
           ON CONFLICT (monitor_id) DO UPDATE SET
             current_pct = EXCLUDED.current_pct,
             rate_per_day = EXCLUDED.rate_per_day,
             days_to_full = EXCLUDED.days_to_full,
             reason_text = EXCLUDED.reason_text,
             status = 'open',
             updated_at = now()`,
          [
            tenantId,
            monitor.id,
            monitor.resource_id,
            forecast.currentPct,
            forecast.ratePerDay,
            forecast.daysToFull,
            reason,
          ],
        );
        recorded += 1;
      }
      return recorded;
    });
  }
}
