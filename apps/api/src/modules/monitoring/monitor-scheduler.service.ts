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
import { AlertEvaluationService } from './alert-evaluation.service';
import { checkAgentStaleness } from './checks/agent-staleness-check';
import { CheckResult, runCheck } from './checks';

const ACTIVELY_POLLED_TYPES = ['http', 'ping', 'port', 'dns', 'ssl'];
// How many missed intervals before a server_agent monitor is considered
// stale -- one missed report alone could just be a slightly late tick.
const STALENESS_MULTIPLIER = 3;

interface DueMonitor {
  id: string;
  name: string;
  resource_id: string;
  monitor_type: string;
  config: Record<string, unknown>;
  consecutive_failures_to_alert: number;
  min_failing_locations?: number;
}

interface DueAgentMonitor extends DueMonitor {
  interval_seconds: number;
  last_seen_at: string | null;
}

interface CheckedEntry {
  monitor: DueMonitor;
  result: CheckResult;
}

/**
 * Polls every tenant on a fixed tick (much finer-grained than the SLA
 * sweep's 60s, since monitor interval_seconds can be as low as 30s). Two
 * independent phases per tenant:
 *
 *  1. Actively polled monitors (http/ping/port/dns/ssl) -- runs the real
 *     checker for each one due.
 *  2. server_agent monitors -- never actively polled (there's nothing to
 *     poll; the device pushes to /agent/heartbeat and /agent/report
 *     instead), so "due" here means "time to check whether we've heard from
 *     it recently enough", using agent_tokens.last_seen_at.
 *
 * 'cloud_metric' monitors are handled by Sprint 4's poller, not here.
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
    private readonly alertEvaluation: AlertEvaluationService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>(
      'MONITOR_SCHEDULER_INTERVAL_MS',
      15000,
    );
    this.timer = setInterval(() => {
      void this.runSweepOnce().catch((err) =>
        this.logger.error(
          `runSweepOnce tick failed: ${(err as Error).message}`,
        ),
      );
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
        try {
          checkedCount += await this.sweepActivelyPolled(tenant.id);
          checkedCount += await this.sweepStaleAgents(tenant.id);
        } catch (err) {
          this.logger.error(
            `tenant ${tenant.id} sweep failed: ${(err as Error).message}`,
          );
        }
      }
      return checkedCount;
    } finally {
      this.running = false;
    }
  }

  private async sweepActivelyPolled(tenantId: string): Promise<number> {
    const dueMonitors = await withTenantContext(
      this.dataSource,
      tenantId,
      (queryRunner) =>
        queryRunner.query(
          `SELECT m.id, m.name, m.resource_id, m.monitor_type, m.config, m.consecutive_failures_to_alert, m.min_failing_locations
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

    const entries = (
      await Promise.all(
        dueMonitors.map(async (monitor): Promise<CheckedEntry | null> => {
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
      )
    ).filter((entry): entry is CheckedEntry => entry !== null);

    await this.recordAndEvaluate(tenantId, entries);
    return entries.length;
  }

  private async sweepStaleAgents(tenantId: string): Promise<number> {
    const dueMonitors = await withTenantContext(
      this.dataSource,
      tenantId,
      (queryRunner) =>
        queryRunner.query(
          `SELECT m.id, m.name, m.resource_id, m.monitor_type, m.config,
                  m.consecutive_failures_to_alert, m.interval_seconds,
                  at.last_seen_at
           FROM monitors m
           LEFT JOIN LATERAL (
             SELECT checked_at FROM monitor_checks mc
             WHERE mc.monitor_id = m.id
             ORDER BY mc.checked_at DESC
             LIMIT 1
           ) lc ON true
           LEFT JOIN agent_tokens at ON at.resource_id = m.resource_id AND at.is_enabled = true
           WHERE m.is_enabled = true
             AND m.monitor_type = 'server_agent'
             AND (lc.checked_at IS NULL OR lc.checked_at < now() - (m.interval_seconds || ' seconds')::interval)`,
          [],
        ) as Promise<DueAgentMonitor[]>,
    );
    if (dueMonitors.length === 0) return 0;

    const entries: CheckedEntry[] = dueMonitors.map((monitor) => ({
      monitor,
      result: checkAgentStaleness(
        monitor.last_seen_at ? new Date(monitor.last_seen_at) : null,
        monitor.interval_seconds * STALENESS_MULTIPLIER,
      ),
    }));

    await this.recordAndEvaluate(tenantId, entries);
    return entries.length;
  }

  private async recordAndEvaluate(
    tenantId: string,
    entries: CheckedEntry[],
  ): Promise<void> {
    if (entries.length === 0) return;

    await withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      for (const entry of entries) {
        await queryRunner.query(
          `INSERT INTO monitor_checks (tenant_id, monitor_id, status, response_time_ms, raw_output, location)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            tenantId,
            entry.monitor.id,
            entry.result.status,
            entry.result.responseTimeMs,
            JSON.stringify(entry.result.rawOutput),
            // This worker's probe location; a multi-region deployment runs an
            // instance per location, each with its own PROBE_LOCATION.
            process.env.PROBE_LOCATION ?? 'default',
          ],
        );
      }
    });

    for (const entry of entries) {
      await this.publishCheckRecorded(tenantId, entry.monitor.id, entry.result);
      try {
        await this.alertEvaluation.evaluate(
          tenantId,
          {
            id: entry.monitor.id,
            name: entry.monitor.name,
            resourceId: entry.monitor.resource_id,
            consecutiveFailuresToAlert:
              entry.monitor.consecutive_failures_to_alert,
            minFailingLocations: entry.monitor.min_failing_locations ?? 1,
          },
          entry.result,
        );
      } catch (err) {
        this.logger.error(
          `alert evaluation failed for monitor ${entry.monitor.id}: ${(err as Error).message}`,
        );
      }
    }
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
