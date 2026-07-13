import { Module } from "@nestjs/common";
import { EventBusModule } from "../event-bus/event-bus.module";
import { EmailChannel } from "./channels/email.channel";
import { NotificationDispatcherService } from "./notification-dispatcher.service";
import { NotificationsService } from "./notifications.service";

@Module({
  imports: [EventBusModule],
  providers: [EmailChannel, NotificationsService, NotificationDispatcherService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
