import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { EventBusModule } from '../../event-bus/event-bus.module';
import { NotificationsModule } from '../../notifications/notifications.module';

/**
 * Platform Services boundary from section 4 of the architecture plan (auth,
 * tenant provisioning, notifications, audit). Notifications is the only
 * piece built so far; auth, tenant provisioning, and audit logging land in
 * later sprints but have an obvious home here rather than being bolted onto
 * one of the three feature verticals. Ticketing/Monitoring/Cost import this
 * module for the database, event bus, and notification dispatch they'll all
 * need.
 */
@Module({
  imports: [DatabaseModule, EventBusModule, NotificationsModule],
  exports: [DatabaseModule, EventBusModule, NotificationsModule],
})
export class PlatformModule {}
