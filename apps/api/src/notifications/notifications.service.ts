import { randomUUID } from "crypto";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { withTenantContext } from "../database/context/tenant-context";
import { EventBusService } from "../event-bus/event-bus.service";

export interface EnqueueNotificationInput {
  tenantId: string;
  channel: "email" | "whatsapp" | "voice" | "in_app";
  recipient: string;
  templateName: string;
  payload: Record<string, unknown>;
}

/**
 * Writes the notification row (status=queued) and publishes
 * notification.requested so NotificationDispatcherService picks it up over
 * the same event bus wired in Sprint 0.3. This is the seam other modules
 * (SLA overdue sweep, alert-to-ticket linking, ...) will call in later
 * sprints instead of sending messages directly.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly eventBus: EventBusService,
  ) {}

  async enqueue(input: EnqueueNotificationInput): Promise<{ id: string }> {
    const id = randomUUID();

    await withTenantContext(this.dataSource, input.tenantId, async (queryRunner) => {
      await queryRunner.query(
        `INSERT INTO notifications (id, tenant_id, channel, recipient, template_name, payload, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'queued')`,
        [id, input.tenantId, input.channel, input.recipient, input.templateName, JSON.stringify(input.payload)],
      );
    });

    await this.eventBus.publish({
      tenantId: input.tenantId,
      eventType: "notification.requested",
      payload: { notificationId: id },
    });

    return { id };
  }
}
