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
import { EventBusService } from '../../event-bus/event-bus.service';
import { CheckResult, runCheck } from './checks';

const ACTIVELY_POLLED_TYPES = ['http', 'ping', 'port', 'dns', 'ssl'];

interface DueMonitor {
  id: string;
  monitor_type: string;
  config: Record<string, unknown>;
}

/**
 * Polls every tenant on a fixed tick (much finer-grained than the SLA
 * sweep's 60s, since monitor interval_seconds can be as low as 30s) and,
 * within each tenant, finds every enabled http/ping/port/dns/ssl monitor
 * whose interval has elapsed since its last recorded check. 'server_agent'
 * and 'cloud_metric' monitors are never selected here -- see checks/index.ts.
 *
 * Mirrors OverdueSweepService's structure (per-tenant transaction, timer +
 * an exposed runSweepOnce for deterministic tests) rather than introducing a
 * second scheduling pattern.
 */
@Injectable()
export class MonitorSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitorSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly eventBus: EventBusService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>(
      'MONITOR_SCHEDULER_INTERVAL_MS',
      15000,
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
      this.logger.warn('monitor sweep already in progress, skipping this tick');
      return 0;
    }
    this.running = true;
    try {
      const tenants = await this.dataSource.query(`SELECT id FROM tenants`);
      let checkedCount = 0;
      for (const tenant of tenants) {
        checkedCount += await this.sweepTenant(tenant.id);
      }
      return checkedCount;
    } finally {
      this.running = false;
    }
  }

  private async sweepTenant(tenantId: string): Promise<number> {
    const dueMonitors = await withTenantContext(
      this.dataSource,
      tenantId,
      (queryRunner) =>
        queryRunner.query(
          `SELECT m.id, m.monitor_type, m.config
           FROM monitors m
           LEFT JOIN LATERAL (
             SELECT checked_at FROM monitor_checks mc
             WHERE mc.monitor_id = m.id
             ORDER BY mc.checked_at DESC
             LIMIT 1
           ) lc ON true
           WHERE m.is_enabled = true
             AND m.monitor_type = ANY($1)
             AND (lc.checked_at IS NULL OR lc.checked_at < now() - (m.interval_seconds || ' seconds')::interval)`,
          [ACTIVELY_POLLED_TYPES],
        ) as Promise<DueMonitor[]>,
    );

    if (dueMonitors.length === 0) return 0;

    const results = await Promise.all(
      dueMonitors.map(async (monitor) => {
        try {
          const result = await runCheck(
            monitor.monitor_type as Parameters<typeof runCheck>[0],
            monitor.config,
          );
          return { monitor, result };
        } catch (err) {
          this.logger.error(
            `check failed for monitor ${monitor.id}: ${(err as Error).message}`,
          );
          return null;
        }
      }),
    );

    await withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      for (const entry of results) {
        if (!entry) continue;
        await queryRunner.query(
          `INSERT INTO monitor_checks (tenant_id, monitor_id, status, response_time_ms, raw_output)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            tenantId,
            entry.monitor.id,
            entry.result.status,
            entry.result.responseTimeMs,
            JSON.stringify(entry.result.rawOutput),
          ],
        );
      }
    });

    for (const entry of results) {
      if (!entry) continue;
      await this.publishCheckRecorded(tenantId, entry.monitor.id, entry.result);
    }

    return results.filter(Boolean).length;
  }

  private async publishCheckRecorded(
    tenantId: string,
    monitorId: string,
    result: CheckResult,
  ): Promise<void> {
    await this.eventBus.publish({
      tenantId,
      eventType: 'monitor.checked',
      payload: {
        monitorId,
        status: result.status,
        responseTimeMs: result.responseTimeMs,
      },
    });
  }
}
