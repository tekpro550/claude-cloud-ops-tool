import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import {
  AlertEvaluationService,
  EvaluatedMonitor,
} from '../alert-evaluation.service';
import { CheckResult } from '../checks/types';
import { validateSyntheticScript } from './synthetic-script';
import { SYNTHETIC_RUNNER, SyntheticRunner } from './synthetic-runner';

interface DueSyntheticMonitor {
  id: string;
  name: string;
  resource_id: string;
  config: Record<string, unknown>;
  consecutive_failures_to_alert: number;
  min_failing_locations?: number;
}

/**
 * Mirrors MonitorSchedulerService's structure (per-tenant transaction, timer
 * + an exposed runSweepOnce for deterministic tests) but as its own service:
 * 'synthetic' isn't in MonitorSchedulerService's ACTIVELY_POLLED_TYPES, so
 * the two schedulers never compete for the same monitor. A synthetic run is
 * a headless-browser script (seconds, not milliseconds) rather than a
 * socket probe, so it gets its own interval and its own runner
 * abstraction (SYNTHETIC_RUNNER) instead of reusing checks/runCheck.
 */
@Injectable()
export class SyntheticSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SyntheticSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly alertEvaluation: AlertEvaluationService,
    private readonly config: ConfigService,
    @Inject(SYNTHETIC_RUNNER) private readonly runner: SyntheticRunner,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>(
      'SYNTHETIC_SCHEDULER_INTERVAL_MS',
      30000,
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
      this.logger.warn(
        'synthetic sweep already in progress, skipping this tick',
      );
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
          `SELECT m.id, m.name, m.resource_id, m.config, m.consecutive_failures_to_alert, m.min_failing_locations
           FROM monitors m
           LEFT JOIN LATERAL (
             SELECT checked_at FROM monitor_checks mc
             WHERE mc.monitor_id = m.id
             ORDER BY mc.checked_at DESC
             LIMIT 1
           ) lc ON true
           WHERE m.is_enabled = true
             AND m.monitor_type = 'synthetic'
             AND (lc.checked_at IS NULL OR lc.checked_at < now() - (m.interval_seconds || ' seconds')::interval)`,
        ) as Promise<DueSyntheticMonitor[]>,
    );
    if (dueMonitors.length === 0) return 0;

    for (const monitor of dueMonitors) {
      try {
        await this.runAndRecord(tenantId, monitor);
      } catch (err) {
        this.logger.error(
          `synthetic run failed for monitor ${monitor.id}: ${(err as Error).message}`,
        );
      }
    }
    return dueMonitors.length;
  }

  private async runAndRecord(
    tenantId: string,
    monitor: DueSyntheticMonitor,
  ): Promise<void> {
    const script = validateSyntheticScript(monitor.config);
    const result = await this.runner.run(script.steps, {
      maxStepMs: script.maxStepMs,
    });
    const status: CheckResult['status'] = result.ok ? 'up' : 'down';
    const failingStep =
      result.failingStepIndex !== null
        ? result.steps[result.failingStepIndex]
        : undefined;

    await withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [check] = await queryRunner.query(
        `INSERT INTO monitor_checks (tenant_id, monitor_id, status, response_time_ms, raw_output, location)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          tenantId,
          monitor.id,
          status,
          result.totalMs,
          JSON.stringify({
            steps: result.steps,
            failingStepIndex: result.failingStepIndex,
          }),
          process.env.PROBE_LOCATION ?? 'default',
        ],
      );
      for (const step of result.steps) {
        await queryRunner.query(
          `INSERT INTO synthetic_run_steps (tenant_id, monitor_check_id, step_index, action, status, duration_ms, error)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            tenantId,
            check.id,
            step.index,
            step.action,
            step.status,
            step.durationMs,
            step.error ?? null,
          ],
        );
      }
    });

    const evaluatedMonitor: EvaluatedMonitor = {
      id: monitor.id,
      name: monitor.name,
      resourceId: monitor.resource_id,
      consecutiveFailuresToAlert: monitor.consecutive_failures_to_alert,
      minFailingLocations: monitor.min_failing_locations ?? 1,
    };
    const checkResult: CheckResult = {
      status,
      responseTimeMs: result.totalMs,
      rawOutput: {
        failingStepIndex: result.failingStepIndex,
        error: failingStep?.error,
      },
    };
    try {
      await this.alertEvaluation.evaluate(
        tenantId,
        evaluatedMonitor,
        checkResult,
      );
    } catch (err) {
      this.logger.error(
        `alert evaluation failed for synthetic monitor ${monitor.id}: ${(err as Error).message}`,
      );
    }
  }
}
