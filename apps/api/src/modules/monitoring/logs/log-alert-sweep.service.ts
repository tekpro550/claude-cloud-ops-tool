import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { isLogLevel, LOG_LEVELS, levelAtLeast } from './log-level';

interface DueLogAlertRule {
  id: string;
  name: string;
  log_source_id: string;
  match_query: string | null;
  level_at_least: string;
  window_seconds: number;
  threshold: number;
}

const TICKET_PRIORITY_BY_LEVEL: Record<string, string> = {
  critical: 'urgent',
  error: 'high',
  warn: 'medium',
  info: 'low',
  debug: 'low',
};

/**
 * Mirrors OverdueSweepService/EscalationSweepService's timer shape. A rule
 * "fires" by opening a ticket via the internal HTTP contract -- the
 * simpler of the two options the plan allows (vs. walking
 * escalation_policy_id's steps the way EscalationSweepService walks an
 * alert's policy); escalation_policy_id is stored on the rule for a later
 * notification path but not read here yet, same "schema now, wiring
 * later" precedent as AddContactAuthAndSourceDetail. last_fired_at debounces
 * repeat firing: a rule that's still over threshold on the next tick won't
 * fire again until its own window has elapsed since the last fire.
 */
@Injectable()
export class LogAlertSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LogAlertSweepService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>(
      'LOG_ALERT_SWEEP_INTERVAL_MS',
      30000,
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
      this.logger.warn(
        'log alert sweep already in progress, skipping this tick',
      );
      return 0;
    }
    this.running = true;
    try {
      const tenants = await this.dataSource.query(`SELECT id FROM tenants`);
      let firedCount = 0;
      for (const tenant of tenants) {
        try {
          firedCount += await this.sweepTenant(tenant.id);
        } catch (err) {
          this.logger.error(
            `tenant ${tenant.id} sweep failed: ${(err as Error).message}`,
          );
        }
      }
      return firedCount;
    } finally {
      this.running = false;
    }
  }

  private async sweepTenant(tenantId: string): Promise<number> {
    const dueRules = await withTenantContext(
      this.dataSource,
      tenantId,
      (queryRunner) =>
        queryRunner.query(
          `SELECT id, name, log_source_id, match_query, level_at_least, window_seconds, threshold
           FROM log_alert_rules
           WHERE is_enabled = true
             AND (last_fired_at IS NULL OR last_fired_at < now() - (window_seconds || ' seconds')::interval)`,
        ) as Promise<DueLogAlertRule[]>,
    );

    let firedCount = 0;
    for (const rule of dueRules) {
      const fired = await this.evaluateRule(tenantId, rule);
      if (fired) firedCount++;
    }
    return firedCount;
  }

  private async evaluateRule(
    tenantId: string,
    rule: DueLogAlertRule,
  ): Promise<boolean> {
    const minLevel = isLogLevel(rule.level_at_least)
      ? rule.level_at_least
      : 'error';
    const levelsAtOrAbove = LOG_LEVELS.filter((l) => levelAtLeast(l, minLevel));

    const count = await withTenantContext(
      this.dataSource,
      tenantId,
      async (queryRunner) => {
        const conditions = [
          `log_source_id = $1`,
          `ts >= now() - ($2 || ' seconds')::interval`,
          `level = ANY($3::text[])`,
        ];
        const params: unknown[] = [
          rule.log_source_id,
          rule.window_seconds,
          levelsAtOrAbove,
        ];
        if (rule.match_query) {
          params.push(rule.match_query);
          conditions.push(
            `to_tsvector('english', message) @@ plainto_tsquery('english', $${params.length})`,
          );
        }
        const [row] = await queryRunner.query(
          `SELECT count(*)::int AS n FROM log_entries WHERE ${conditions.join(' AND ')}`,
          params,
        );
        return row.n as number;
      },
    );

    if (count < rule.threshold) return false;

    await withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `UPDATE log_alert_rules SET last_fired_at = now() WHERE id = $1`,
        [rule.id],
      ),
    );

    try {
      await this.callInternalApi('/internal/tickets/from_alert', {
        tenantId,
        subject: `[Logs] ${rule.name}: ${count} matching entries in the last ${rule.window_seconds}s`,
        description: `Log alert rule "${rule.name}" crossed its threshold: ${count} entries at level >= ${minLevel}${rule.match_query ? ` matching "${rule.match_query}"` : ''} in the trailing ${rule.window_seconds}s (threshold ${rule.threshold}).`,
        priority: TICKET_PRIORITY_BY_LEVEL[minLevel] ?? 'medium',
      });
    } catch (err) {
      this.logger.error(
        `failed to open ticket for log alert rule ${rule.id}: ${(err as Error).message}`,
      );
    }
    return true;
  }

  private async callInternalApi(
    path: string,
    body: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const baseUrl = this.config.get<string>(
      'INTERNAL_API_BASE_URL',
      'http://localhost:3000/api/v1',
    );
    const apiKey = this.config.get<string>(
      'INTERNAL_API_KEY',
      'dev-internal-api-key',
    );

    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(
        `internal API ${path} returned ${response.status}: ${await response.text()}`,
      );
    }
    return response.json();
  }
}
