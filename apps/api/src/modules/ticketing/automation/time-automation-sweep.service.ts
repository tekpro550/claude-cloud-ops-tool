import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { applyAction, AutomationAction } from './apply-action';
import {
  AutomationCondition,
  conditionMatches,
} from './automation-rules.service';

/**
 * Time-triggered automation ("unresolved for N hours" style rules) --
 * the Freshdesk Growth-plan gap this session's feature comparison flagged.
 * Rules that fire on ticket_created/ticket_updated apply immediately inside
 * TicketsService's own transaction; a time_based rule has no such moment to
 * hook, so it needs its own periodic sweep, same shape as
 * OverdueSweepService's SLA-breach sweep.
 *
 * Each rule fires at most once per ticket: automation_rule_applications is
 * the dedupe guard, checked (and written) inside the same query that finds
 * candidates, so overlapping sweep runs can't double-apply a rule.
 */
@Injectable()
export class TimeAutomationSweepService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TimeAutomationSweepService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>(
      'TIME_AUTOMATION_SWEEP_INTERVAL_MS',
      60000,
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

  /** Exposed as a plain method, same as OverdueSweepService, so tests can drive one pass deterministically. */
  async runSweepOnce(): Promise<number> {
    if (this.running) {
      this.logger.warn('sweep already in progress, skipping this tick');
      return 0;
    }
    this.running = true;
    try {
      const tenants = await this.dataSource.query(`SELECT id FROM tenants`);
      let appliedCount = 0;
      for (const tenant of tenants) {
        try {
          appliedCount += await this.sweepTenant(tenant.id);
        } catch (err) {
          this.logger.error(
            `tenant ${tenant.id} sweep failed: ${(err as Error).message}`,
          );
        }
      }
      return appliedCount;
    } finally {
      this.running = false;
    }
  }

  private async sweepTenant(tenantId: string): Promise<number> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const rules: Array<{
        id: string;
        time_trigger_minutes: number;
        conditions: AutomationCondition[];
        actions: AutomationAction[];
      }> = await queryRunner.query(
        `SELECT id, time_trigger_minutes, conditions, actions FROM automation_rules
         WHERE trigger = 'time_based' AND is_active = true AND time_trigger_minutes IS NOT NULL`,
      );
      if (rules.length === 0) return 0;

      let appliedCount = 0;
      for (const rule of rules) {
        appliedCount += await this.sweepRule(tenantId, rule, queryRunner);
      }
      return appliedCount;
    });
  }

  private async sweepRule(
    tenantId: string,
    rule: {
      id: string;
      time_trigger_minutes: number;
      conditions: AutomationCondition[];
      actions: AutomationAction[];
    },
    queryRunner: QueryRunner,
  ): Promise<number> {
    // Candidates: old enough, still open, and this rule hasn't already
    // fired for them. Condition matching (status/priority/etc equality)
    // happens in-process below, same as the event-triggered path, since
    // it's the same small DSL either way.
    const candidates = await queryRunner.query(
      `SELECT t.* FROM tickets t
       WHERE t.status NOT IN ('resolved', 'closed')
         AND t.created_at <= now() - ($1 || ' minutes')::interval
         AND NOT EXISTS (
           SELECT 1 FROM automation_rule_applications ara
           WHERE ara.automation_rule_id = $2 AND ara.ticket_id = t.id
         )`,
      [rule.time_trigger_minutes, rule.id],
    );

    let appliedCount = 0;
    for (const ticket of candidates) {
      const conditionsMet = rule.conditions.every((c) =>
        conditionMatches(ticket, c),
      );
      if (!conditionsMet) continue;

      let current = ticket;
      for (const action of rule.actions) {
        current = await applyAction(tenantId, current, action, queryRunner);
      }
      await queryRunner.query(
        `INSERT INTO automation_rule_applications (tenant_id, automation_rule_id, ticket_id) VALUES ($1, $2, $3)
         ON CONFLICT (automation_rule_id, ticket_id) DO NOTHING`,
        [tenantId, rule.id, ticket.id],
      );
      appliedCount += 1;
    }
    return appliedCount;
  }
}
