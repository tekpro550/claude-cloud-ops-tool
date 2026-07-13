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
import { EventBusService } from '../../../event-bus/event-bus.service';
import { NotificationsService } from '../../../notifications/notifications.service';

const TICKET_OVERDUE = 'ticket.overdue';

export type OverdueType = 'first_response' | 'resolution';

interface OverdueBreach {
  ticket: Record<string, any>;
  overdueType: OverdueType;
  dueAt: Date;
}

/**
 * Periodically scans every tenant for tickets that have just breached an SLA
 * target (first response or resolution) and haven't been flagged yet, fires
 * ticket.overdue on the shared event bus, and enqueues an email to the
 * assigned agent. Each breach is marked via a *_overdue_notified_at column on
 * the ticket the moment it's found, in the same transaction as the read, so
 * a ticket is never notified twice even across overlapping/interval-driven
 * runs.
 */
@Injectable()
export class OverdueSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OverdueSweepService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly eventBus: EventBusService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>('SLA_SWEEP_INTERVAL_MS', 60000);
    this.timer = setInterval(() => {
      void this.runSweepOnce();
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Exposed as a plain method (not just the timer callback) so tests can
   * drive one sweep pass deterministically instead of waiting on the
   * interval. Tenants are enumerated via the unrestricted `tenants` table
   * (no RLS on it, see the Foundation migration) and then each is swept
   * inside its own tenant-scoped transaction.
   */
  async runSweepOnce(): Promise<number> {
    if (this.running) {
      this.logger.warn('sweep already in progress, skipping this tick');
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
    const breaches = await withTenantContext(
      this.dataSource,
      tenantId,
      async (queryRunner) => {
        const tickets = await queryRunner.query(
          `SELECT * FROM tickets
           WHERE status NOT IN ('resolved', 'closed')
             AND (
               (first_response_due_at IS NOT NULL AND first_response_at IS NULL AND first_response_due_at < now() AND first_response_overdue_notified_at IS NULL)
               OR
               (resolution_due_at IS NOT NULL AND resolved_at IS NULL AND resolution_due_at < now() AND resolution_overdue_notified_at IS NULL)
             )`,
        );

        const found: OverdueBreach[] = [];
        for (const ticket of tickets) {
          if (
            ticket.first_response_due_at &&
            !ticket.first_response_at &&
            new Date(ticket.first_response_due_at) < new Date() &&
            !ticket.first_response_overdue_notified_at
          ) {
            found.push({
              ticket,
              overdueType: 'first_response',
              dueAt: ticket.first_response_due_at,
            });
            await queryRunner.query(
              `UPDATE tickets SET first_response_overdue_notified_at = now() WHERE id = $1`,
              [ticket.id],
            );
          }
          if (
            ticket.resolution_due_at &&
            !ticket.resolved_at &&
            new Date(ticket.resolution_due_at) < new Date() &&
            !ticket.resolution_overdue_notified_at
          ) {
            found.push({
              ticket,
              overdueType: 'resolution',
              dueAt: ticket.resolution_due_at,
            });
            await queryRunner.query(
              `UPDATE tickets SET resolution_overdue_notified_at = now() WHERE id = $1`,
              [ticket.id],
            );
          }
        }
        return found;
      },
    );

    for (const breach of breaches) {
      await this.dispatchBreach(tenantId, breach);
    }
    return breaches.length;
  }

  private async dispatchBreach(
    tenantId: string,
    breach: OverdueBreach,
  ): Promise<void> {
    const { ticket, overdueType, dueAt } = breach;
    const dueAtIso = dueAt instanceof Date ? dueAt.toISOString() : dueAt;

    await this.eventBus.publish({
      tenantId,
      eventType: TICKET_OVERDUE,
      payload: {
        ticketId: ticket.id,
        ticketNumber: ticket.ticket_number,
        overdueType,
        dueAt: dueAtIso,
      },
    });

    if (!ticket.agent_id) {
      this.logger.warn(
        `ticket ${ticket.id} is ${overdueType} overdue but has no assigned agent to notify`,
      );
      return;
    }

    const recipient = await this.resolveAgentEmail(tenantId, ticket.agent_id);
    if (!recipient) {
      this.logger.warn(
        `ticket ${ticket.id}'s assigned agent ${ticket.agent_id} has no resolvable email`,
      );
      return;
    }

    await this.notifications.enqueue({
      tenantId,
      channel: 'email',
      recipient,
      templateName: 'ticket.overdue',
      payload: {
        ticketNumber: ticket.ticket_number,
        subject: ticket.subject,
        overdueType,
        dueAt: dueAtIso,
      },
    });
  }

  private async resolveAgentEmail(
    tenantId: string,
    agentId: string,
  ): Promise<string | null> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [row] = await queryRunner.query(
        `SELECT u.email FROM agents a JOIN users u ON u.id = a.user_id WHERE a.id = $1`,
        [agentId],
      );
      return row?.email ?? null;
    });
  }
}
