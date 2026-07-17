import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { EventBusService } from '../../event-bus/event-bus.service';
import { CheckResult } from './checks/types';
import { generateReasonText, generateRepeatNoteText } from './reason-text';

const DUPLICATE_KEY_ERROR = '23505';
// Avoid posting a ticket note on every single repeat check (which could be
// every 30s) -- only every Nth continued failure.
const REPEAT_NOTE_EVERY = 5;

export interface EvaluatedMonitor {
  id: string;
  name: string;
  resourceId: string;
  consecutiveFailuresToAlert: number;
  /** How many distinct probe locations must be failing before an alert opens (default 1). */
  minFailingLocations?: number;
}

type EvaluationOutcome =
  | {
      action:
        | 'no_rule'
        | 'not_bad'
        | 'not_yet_due'
        | 'lost_race'
        | 'awaiting_location_quorum';
    }
  | { action: 'repeat'; ticketId: string | null; noteBody: string | null }
  | { action: 'resolved'; ticketId: string | null }
  | { action: 'created'; alertId: string; reasonText: string };

/**
 * Called once per recorded check (see MonitorSchedulerService). Debounces
 * via monitor.consecutiveFailuresToAlert against monitor_checks history,
 * dedupes via the DB-level "one open alert per monitor" constraint, and
 * keeps alert-to-ticket linking idempotent: a monitor only ever gets one
 * open alert and that alert only ever gets one ticket, no matter how many
 * times evaluate() runs while the underlying problem persists.
 */
@Injectable()
export class AlertEvaluationService {
  private readonly logger = new Logger(AlertEvaluationService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly eventBus: EventBusService,
    private readonly config: ConfigService,
  ) {}

  async evaluate(
    tenantId: string,
    monitor: EvaluatedMonitor,
    result: CheckResult,
  ): Promise<void> {
    const outcome = await this.applyToDatabase(tenantId, monitor, result);

    switch (outcome.action) {
      case 'created':
        await this.eventBus.publish({
          tenantId,
          eventType: 'alert.created',
          payload: { alertId: outcome.alertId, monitorId: monitor.id },
        });
        await this.linkTicket(
          tenantId,
          monitor,
          outcome.alertId,
          outcome.reasonText,
        );
        return;
      case 'repeat':
        if (outcome.ticketId && outcome.noteBody) {
          await this.postNote(tenantId, outcome.ticketId, outcome.noteBody);
        }
        return;
      case 'resolved':
        if (outcome.ticketId) {
          await this.postNote(
            tenantId,
            outcome.ticketId,
            generateReasonText(monitor.name, 'up', {}),
          );
        }
        return;
      default:
        return;
    }
  }

  /**
   * Everything that only touches Postgres happens in one transaction; the
   * HTTP calls to the ticketing module's internal endpoints deliberately
   * happen afterwards, outside it, so a slow network call never holds a
   * database transaction open.
   */
  private async applyToDatabase(
    tenantId: string,
    monitor: EvaluatedMonitor,
    result: CheckResult,
  ): Promise<EvaluationOutcome> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rule] = await queryRunner.query(
        `SELECT * FROM alert_rules WHERE monitor_id = $1 AND is_enabled = true`,
        [monitor.id],
      );
      if (!rule) return { action: 'no_rule' };

      const statusIn: string[] = rule.condition?.statusIn ?? [
        'down',
        'critical',
      ];
      const isBad = statusIn.includes(result.status);

      // 'acknowledged' counts as active alongside 'open' -- a human
      // acknowledging an alert shouldn't let a still-failing monitor open a
      // second, duplicate alert (see the migration's partial unique index).
      const [openAlert] = await queryRunner.query(
        `SELECT * FROM alerts WHERE monitor_id = $1 AND status IN ('open', 'acknowledged')`,
        [monitor.id],
      );

      if (!isBad) {
        if (openAlert && result.status === 'up') {
          await queryRunner.query(
            `UPDATE alerts SET status = 'resolved', resolved_at = now() WHERE id = $1`,
            [openAlert.id],
          );
          return { action: 'resolved', ticketId: openAlert.ticket_id };
        }
        return { action: 'not_bad' };
      }

      if (openAlert) {
        const newRepeatCount = openAlert.repeat_count + 1;
        await queryRunner.query(
          `UPDATE alerts SET repeat_count = $2, last_seen_at = now() WHERE id = $1`,
          [openAlert.id, newRepeatCount],
        );
        const shouldNote =
          openAlert.ticket_id && newRepeatCount % REPEAT_NOTE_EVERY === 0;
        return {
          action: 'repeat',
          ticketId: openAlert.ticket_id,
          noteBody: shouldNote
            ? generateRepeatNoteText(
                monitor.name,
                result.status,
                result.rawOutput,
                newRepeatCount,
              )
            : null,
        };
      }

      const recentChecks = await queryRunner.query(
        `SELECT status FROM monitor_checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT $2`,
        [monitor.id, monitor.consecutiveFailuresToAlert],
      );
      const thresholdReached =
        recentChecks.length === monitor.consecutiveFailuresToAlert &&
        recentChecks.every((c: { status: string }) =>
          statusIn.includes(c.status),
        );
      if (!thresholdReached) return { action: 'not_yet_due' };

      // Multi-location false-positive suppression: only open once enough
      // distinct probe locations are currently failing. With the default of 1
      // this is a no-op (single-location behavior); set higher to require a
      // quorum so one region's blip doesn't page anyone.
      const minLocations = monitor.minFailingLocations ?? 1;
      if (minLocations > 1) {
        const perLocation = await queryRunner.query(
          `SELECT DISTINCT ON (location) location, status
           FROM monitor_checks WHERE monitor_id = $1
           ORDER BY location, checked_at DESC`,
          [monitor.id],
        );
        const failingLocations = perLocation.filter((c: { status: string }) =>
          statusIn.includes(c.status),
        ).length;
        if (failingLocations < minLocations) {
          return { action: 'awaiting_location_quorum' };
        }
      }

      const reasonText = generateReasonText(
        monitor.name,
        result.status,
        result.rawOutput,
      );
      try {
        const [alert] = await queryRunner.query(
          `INSERT INTO alerts (tenant_id, monitor_id, alert_rule_id, severity, reason_text)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [tenantId, monitor.id, rule.id, rule.severity, reasonText],
        );
        return { action: 'created', alertId: alert.id, reasonText };
      } catch (err) {
        if ((err as { code?: string }).code === DUPLICATE_KEY_ERROR) {
          // A concurrent evaluation already opened one for this monitor.
          return { action: 'lost_race' };
        }
        throw err;
      }
    });
  }

  private async linkTicket(
    tenantId: string,
    monitor: EvaluatedMonitor,
    alertId: string,
    reasonText: string,
  ): Promise<void> {
    const ticket = await this.callInternalApi('/internal/tickets/from_alert', {
      tenantId,
      subject: `[Monitoring] ${monitor.name} is failing`,
      description: reasonText,
      resourceId: monitor.resourceId,
      priority: 'high',
    });
    if (!ticket?.id) {
      this.logger.error(
        `alert ${alertId} was created but ticket creation returned no id -- alert is left unlinked`,
      );
      return;
    }

    await withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `UPDATE alerts SET ticket_id = $2 WHERE id = $1 AND ticket_id IS NULL`,
        [alertId, ticket.id],
      ),
    );
  }

  private async postNote(
    tenantId: string,
    ticketId: string,
    body: string,
  ): Promise<void> {
    await this.callInternalApi(`/internal/tickets/${ticketId}/notes`, {
      tenantId,
      body,
    });
  }

  private async callInternalApi(
    path: string,
    body: Record<string, unknown>,
  ): Promise<any> {
    const baseUrl = this.config.get<string>(
      'INTERNAL_API_BASE_URL',
      'http://localhost:3000/api/v1',
    );
    const apiKey = this.config.get<string>(
      'INTERNAL_API_KEY',
      'dev-internal-api-key',
    );

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Api-Key': apiKey,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        this.logger.error(
          `internal call to ${path} failed with status ${response.status}: ${await response.text()}`,
        );
        return null;
      }
      return await response.json();
    } catch (err) {
      this.logger.error(
        `internal call to ${path} failed: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
