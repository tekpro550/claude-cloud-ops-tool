import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { DataSource, QueryRunner } from "typeorm";
import { withTenantContext } from "../database/context/tenant-context";
import { EventBusService } from "../event-bus/event-bus.service";
import { DomainEventMessage } from "../event-bus/event-bus.types";
import { EmailChannel } from "./channels/email.channel";
import { NotificationChannel, stubChannel } from "./channels/notification-channel.interface";
import { renderTemplate } from "./templates/template-registry";

const NOTIFICATION_REQUESTED = "notification.requested";
const CONSUMER_GROUP = "notification-dispatcher";

/**
 * Consumes notification.requested off the shared event bus and dispatches
 * through the channel the notification was queued for. Only "email" has a
 * real implementation in Sprint 0 — whatsapp/voice/in_app are wired to the
 * same dispatch path but stubbed, so a queued notification on those channels
 * ends up "failed" with a clear reason rather than silently vanishing.
 */
@Injectable()
export class NotificationDispatcherService implements OnModuleInit {
  private readonly logger = new Logger(NotificationDispatcherService.name);
  private readonly channels: Map<string, NotificationChannel>;

  constructor(
    private readonly eventBus: EventBusService,
    @InjectDataSource() private readonly dataSource: DataSource,
    emailChannel: EmailChannel,
  ) {
    this.channels = new Map<string, NotificationChannel>([
      ["email", emailChannel],
      ["whatsapp", stubChannel("whatsapp")],
      ["voice", stubChannel("voice")],
      ["in_app", stubChannel("in_app")],
    ]);
  }

  async onModuleInit(): Promise<void> {
    await this.eventBus.consume(CONSUMER_GROUP, (event) => this.handleEvent(event));
  }

  private async handleEvent(event: DomainEventMessage): Promise<void> {
    if (event.eventType !== NOTIFICATION_REQUESTED) return;

    const notificationId = event.payload.notificationId as string;

    await withTenantContext(this.dataSource, event.tenantId, async (queryRunner) => {
      const rows = await queryRunner.query(
        `SELECT id, channel, recipient, template_name, payload FROM notifications WHERE id = $1`,
        [notificationId],
      );
      const notification = rows[0];
      if (!notification) {
        this.logger.warn(`notification ${notificationId} not found (already processed or invalid)`);
        return;
      }

      const channelImpl = this.channels.get(notification.channel);
      if (!channelImpl) {
        await this.markFailed(queryRunner, notificationId, `no channel implementation registered for "${notification.channel}"`);
        return;
      }

      try {
        const message = renderTemplate(notification.template_name, notification.payload);
        await channelImpl.send({ recipient: notification.recipient, message, payload: notification.payload });
        await queryRunner.query(`UPDATE notifications SET status = 'sent', sent_at = now() WHERE id = $1`, [
          notificationId,
        ]);
      } catch (err) {
        await this.markFailed(queryRunner, notificationId, (err as Error).message);
      }
    });
  }

  private async markFailed(queryRunner: QueryRunner, notificationId: string, reason: string): Promise<void> {
    this.logger.error(`notification ${notificationId} failed: ${reason}`);
    await queryRunner.query(`UPDATE notifications SET status = 'failed' WHERE id = $1`, [notificationId]);
  }
}
