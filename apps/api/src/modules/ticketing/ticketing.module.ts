import { Module } from '@nestjs/common';
import { EventBusModule } from '../../event-bus/event-bus.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PlatformModule } from '../platform/platform.module';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AutomationRulesController } from './automation/automation-rules.controller';
import { AutomationRulesService } from './automation/automation-rules.service';
import { CannedResponsesController } from './canned-responses.controller';
import { CannedResponsesService } from './canned-responses.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { EmailIntakeService } from './email-intake/email-intake.service';
import { InternalTicketsController } from './internal/internal-tickets.controller';
import { OverdueSweepService } from './sla/overdue-sweep.service';
import { ReferenceDataController } from './reference-data.controller';
import { ReferenceDataService } from './reference-data.service';
import { TicketTimeLogsController } from './ticket-time-logs.controller';
import { TicketTimeLogsService } from './ticket-time-logs.service';
import { TicketTodosController } from './ticket-todos.controller';
import { TicketTodosService } from './ticket-todos.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

/**
 * Ticketing Service boundary from section 4 of the architecture plan
 * (Module 1) — see docs/Cloud-Ops-Tool-Module1-Foundation-Ticketing-Scope.md.
 */
@Module({
  imports: [PlatformModule, EventBusModule, NotificationsModule],
  controllers: [
    TicketsController,
    ReferenceDataController,
    AutomationRulesController,
    CannedResponsesController,
    TicketTodosController,
    TicketTimeLogsController,
    DashboardController,
    AdminController,
    InternalTicketsController,
  ],
  providers: [
    TicketsService,
    EmailIntakeService,
    OverdueSweepService,
    ReferenceDataService,
    AutomationRulesService,
    CannedResponsesService,
    TicketTodosService,
    TicketTimeLogsService,
    DashboardService,
    AdminService,
  ],
})
export class TicketingModule {}
