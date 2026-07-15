import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { NotificationsService } from '../../notifications/notifications.service';
import { renderNotificationTemplate } from '../monitoring/notification-template-render';
import { calculateBudgetPace, generateCostInsightText } from './cost-pace';

const EVENT_TYPE = 'cost.pace_alert';
const DEFAULT_BODY = '$SEVERITY: $INSIGHT';

interface CostBudgetRow {
  id: string;
  name: string;
  cloud_credential_id: string | null;
  monthly_budget_amount: string | null;
  pace_warning_threshold_pct: number;
  pace_critical_threshold_pct: number;
  notify_channel: 'email' | 'whatsapp' | 'voice' | 'in_app' | null;
  notify_recipient: string | null;
}

const SEVERITY_RANK = { info: 1, warning: 2, critical: 3 } as const;

/**
 * Runs once per tenant after CostBillingSyncService finishes syncing that
 * tenant's cost_line_items (see docs/Cloud-Ops-Tool-Module3-Cost-FinOps-Scope.md
 * section 4's "then runs the MTD pace check against cost_budgets and fires
 * alerts"). Reuses the alerts table exactly the way a monitoring alert
 * does -- alerts.cost_budget_id, the partial unique index that guarantees
 * one active alert per budget -- rather than a parallel notification
 * concept, per section 2. Only re-notifies when a new alert opens or its
 * severity gets worse, the same "don't spam on an unchanged condition"
 * principle Module 2's escalation/repeat-note logic used.
 */
@Injectable()
export class CostPaceCheckService {
  private readonly logger = new Logger(CostPaceCheckService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
  ) {}

  async checkTenant(tenantId: string): Promise<number> {
    const budgets: CostBudgetRow[] = await withTenantContext(
      this.dataSource,
      tenantId,
      (queryRunner) =>
        queryRunner.query(
          `SELECT id, name, cloud_credential_id, monthly_budget_amount, pace_warning_threshold_pct, pace_critical_threshold_pct, notify_channel, notify_recipient
           FROM cost_budgets WHERE is_active = true`,
        ),
    );

    let alertedCount = 0;
    for (const budget of budgets) {
      try {
        if (await this.checkBudget(tenantId, budget)) alertedCount++;
      } catch (err) {
        this.logger.error(
          `pace check for cost_budgets ${budget.id} failed: ${(err as Error).message}`,
        );
      }
    }
    return alertedCount;
  }

  private async checkBudget(
    tenantId: string,
    budget: CostBudgetRow,
  ): Promise<boolean> {
    const now = new Date();
    const daysElapsed = now.getUTCDate();
    const daysInMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    ).getUTCDate();

    const { mtdSpend, previousMonthTotal } = await withTenantContext(
      this.dataSource,
      tenantId,
      async (queryRunner) => {
        const credentialFilter = budget.cloud_credential_id
          ? `AND cloud_credential_id = $2`
          : '';
        const params = budget.cloud_credential_id
          ? [tenantId, budget.cloud_credential_id]
          : [tenantId];

        const [mtdRow] = await queryRunner.query(
          `SELECT COALESCE(SUM(amount), 0)::float AS total FROM cost_line_items
           WHERE tenant_id = $1 ${credentialFilter}
             AND usage_date >= date_trunc('month', now())::date`,
          params,
        );
        const [prevRow] = await queryRunner.query(
          `SELECT COALESCE(SUM(amount), 0)::float AS total FROM cost_line_items
           WHERE tenant_id = $1 ${credentialFilter}
             AND usage_date >= (date_trunc('month', now()) - interval '1 month')::date
             AND usage_date < date_trunc('month', now())::date`,
          params,
        );
        return {
          mtdSpend: mtdRow.total as number,
          previousMonthTotal:
            (prevRow.total as number) > 0 ? (prevRow.total as number) : null,
        };
      },
    );

    const result = calculateBudgetPace({
      mtdSpend,
      previousMonthTotal,
      monthlyBudgetAmount: budget.monthly_budget_amount
        ? Number(budget.monthly_budget_amount)
        : null,
      daysElapsed,
      daysInMonth,
      warningThresholdPct: budget.pace_warning_threshold_pct,
      criticalThresholdPct: budget.pace_critical_threshold_pct,
    });

    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [openAlert] = await queryRunner.query(
        `SELECT * FROM alerts WHERE cost_budget_id = $1 AND status IN ('open', 'acknowledged')`,
        [budget.id],
      );

      if (!result || !result.severity) {
        if (openAlert) {
          await queryRunner.query(
            `UPDATE alerts SET status = 'resolved', resolved_at = now() WHERE id = $1`,
            [openAlert.id],
          );
        }
        return false;
      }

      const reasonText = generateCostInsightText(budget.name, result);

      if (!openAlert) {
        await queryRunner.query(
          `INSERT INTO alerts (tenant_id, cost_budget_id, severity, reason_text)
           VALUES ($1, $2, $3, $4)`,
          [tenantId, budget.id, result.severity, reasonText],
        );
        await this.notify(tenantId, budget, result.severity, reasonText);
        return true;
      }

      const severityIncreased =
        SEVERITY_RANK[result.severity] >
        SEVERITY_RANK[openAlert.severity as keyof typeof SEVERITY_RANK];
      await queryRunner.query(
        `UPDATE alerts SET severity = $2, reason_text = $3, repeat_count = repeat_count + 1, last_seen_at = now() WHERE id = $1`,
        [openAlert.id, result.severity, reasonText],
      );
      if (severityIncreased) {
        await this.notify(tenantId, budget, result.severity, reasonText);
      }
      return true;
    });
  }

  private async notify(
    tenantId: string,
    budget: CostBudgetRow,
    severity: string,
    reasonText: string,
  ): Promise<void> {
    if (!budget.notify_channel || !budget.notify_recipient) return;

    const body = await withTenantContext(
      this.dataSource,
      tenantId,
      async (queryRunner: QueryRunner) => {
        const [template] = await queryRunner.query(
          `SELECT body FROM notification_templates WHERE channel = $1 AND event_type = $2 AND is_default = true`,
          [budget.notify_channel, EVENT_TYPE],
        );
        return renderNotificationTemplate(template?.body ?? DEFAULT_BODY, {
          SEVERITY: severity,
          INSIGHT: reasonText,
          BUDGET_NAME: budget.name,
        });
      },
    );

    await this.notifications.enqueue({
      tenantId,
      channel: budget.notify_channel,
      recipient: budget.notify_recipient,
      templateName: 'cost.pace_alert',
      payload: { subject: `Cost alert: ${budget.name}`, body },
    });
  }
}
