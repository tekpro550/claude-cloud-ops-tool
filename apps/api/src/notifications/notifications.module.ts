import { Module } from '@nestjs/common';
import { EventBusModule } from '../event-bus/event-bus.module';
import { EmailChannel } from './channels/email.channel';
import { SlackChannel } from './channels/slack.channel';
import { WebhookChannel } from './channels/webhook.channel';
import { NotificationDispatcherService } from './notification-dispatcher.service';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [EventBusModule],
  providers: [
    EmailChannel,
    SlackChannel,
    WebhookChannel,
    NotificationsService,
    NotificationDispatcherService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
