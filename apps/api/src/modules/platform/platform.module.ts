import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { EventBusModule } from '../../event-bus/event-bus.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { AuditLogController } from './audit/audit-log.controller';
import { AuditLogService } from './audit/audit-log.service';
import { AuthModule } from './auth/auth.module';

/**
 * Platform Services boundary from section 4 of the architecture plan (auth,
 * tenant provisioning, notifications, audit). Tenant provisioning lands in a
 * later sprint but has an obvious home here rather than being bolted onto one
 * of the three feature verticals. Ticketing/Monitoring/Cost import this module
 * for the database, event bus, notification dispatch, and audit logging they
 * all need.
 */
@Module({
  imports: [DatabaseModule, EventBusModule, NotificationsModule, AuthModule],
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [
    DatabaseModule,
    EventBusModule,
    NotificationsModule,
    AuthModule,
    AuditLogService,
  ],
})
export class PlatformModule {}
