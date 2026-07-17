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
import { NotificationsService } from '../../notifications/notifications.service';
import { renderNotificationTemplate } from './notification-template-render';

const EVENT_TYPE = 'alert.escalated';
const DEFAULT_BODY =
  'Alert escalation, step $STEP_NUMBER: $MONITOR_NAME is $SEVERITY. $REASON';

interface EscalationStep {
  delayMinutes: number;
  notify: {
    channel:
      'email' | 'slack' | 'webhook' | 'sms' | 'whatsapp' | 'voice' | 'in_app';
    recipient: string;
  }[];
}

interface PendingEscalation {
  alertId: string;
  monitorName: string;
  severity: string;
  reasonText: string;
  step: EscalationStep;
  stepNumber: number;
}

/**
 * Walks each open/acknowledged alert's escalation policy one step at a time,
 * firing notifications once each step's delayMinutes has elapsed since the
 * alert opened. alerts.last_escalated_step is the persisted marker (written
 * in the same query as the "is this due" check) that makes a step fire
 * exactly once no matter how many overlapping sweep passes run -- the same
 * mark-then-notify shape as OverdueSweepService's
 * *_overdue_notified_at columns, applied to a variable-length step list
 * instead of two fixed SLA targets.
 */
@Injectable()
export class EscalationSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EscalationSweepService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>(
      'ESCALATION_SWEEP_INTERVAL_MS',
      60000,
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
        'escalation sweep already in progress, skipping this tick',
      );
      return 0;
    }
    this.running = true;
    try {
      const tenants = await this.dataSource.query(`SELECT id FROM tenants`);
      let notifiedCount = 0;
      for (const tenant of tenants) {
        notifiedCount += await this.sweepTenant(tenant.id);
      }
      return notifiedCount;
    } finally {
      this.running = false;
    }
  }

  private async sweepTenant(tenantId: string): Promise<number> {
    const pending = await withTenantContext(
      this.dataSource,
      tenantId,
      async (queryRunner) => {
        const dueAlerts = await queryRunner.query(
          `SELECT a.id, a.severity, a.reason_text, a.opened_at, a.last_escalated_step, m.name AS monitor_name, ep.steps
         FROM alerts a
         JOIN alert_rules ar ON ar.id = a.alert_rule_id
         JOIN escalation_policies ep ON ep.id = ar.escalation_policy_id
         JOIN monitors m ON m.id = a.monitor_id
         WHERE a.status IN ('open', 'acknowledged')`,
        );

        const actions: PendingEscalation[] = [];
        for (const alert of dueAlerts) {
          const steps: EscalationStep[] = alert.steps ?? [];
          const nextIndex = alert.last_escalated_step + 1;
          if (nextIndex >= steps.length) continue;

          const nextStep = steps[nextIndex];
          const dueAt =
            new Date(alert.opened_at).getTime() +
            nextStep.delayMinutes * 60_000;
          if (Date.now() < dueAt) continue;

          await queryRunner.query(
            `UPDATE alerts SET last_escalated_step = $2 WHERE id = $1`,
            [alert.id, nextIndex],
          );
          actions.push({
            alertId: alert.id,
            monitorName: alert.monitor_name,
            severity: alert.severity,
            reasonText: alert.reason_text,
            step: nextStep,
            stepNumber: nextIndex,
          });
        }
        return actions;
      },
    );

    for (const action of pending) {
      for (const target of action.step.notify) {
        const body = await this.renderBody(tenantId, target.channel, action);
        await this.notifications.enqueue({
          tenantId,
          channel: target.channel,
          recipient: target.recipient,
          templateName: 'monitoring.escalation',
          payload: { subject: `Alert escalation: ${action.monitorName}`, body },
        });
      }
    }
    return pending.length;
  }

  private async renderBody(
    tenantId: string,
    channel: string,
    action: PendingEscalation,
  ): Promise<string> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [template] = await queryRunner.query(
        `SELECT body FROM notification_templates WHERE channel = $1 AND event_type = $2 AND is_default = true`,
        [channel, EVENT_TYPE],
      );
      return renderNotificationTemplate(template?.body ?? DEFAULT_BODY, {
        MONITOR_NAME: action.monitorName,
        SEVERITY: action.severity,
        REASON: action.reasonText,
        STEP_NUMBER: String(action.stepNumber + 1),
      });
    });
  }
}
