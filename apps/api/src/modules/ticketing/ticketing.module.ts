import { Module } from '@nestjs/common';
import { EventBusModule } from '../../event-bus/event-bus.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PlatformModule } from '../platform/platform.module';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AutomationRulesController } from './automation/automation-rules.controller';
import { AutomationRulesService } from './automation/automation-rules.service';
import { CannedResponsesController } from './canned-responses.controller';
import { CannedResponsesService } from './canned-responses.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { EmailIntakeService } from './email-intake/email-intake.service';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { InternalTicketsController } from './internal/internal-tickets.controller';
import { FreshdeskClient } from './migration/freshdesk-client';
import { FreshdeskMigrationService } from './migration/freshdesk-migration.service';
import { OverdueSweepService } from './sla/overdue-sweep.service';
import { SlaPoliciesController } from './sla-policies.controller';
import { SlaPoliciesService } from './sla-policies.service';
import { TicketTimeLogsController } from './ticket-time-logs.controller';
import { TicketTimeLogsService } from './ticket-time-logs.service';
import { TicketTodosController } from './ticket-todos.controller';
import { TicketTodosService } from './ticket-todos.service';
import { TicketTypesController } from './ticket-types.controller';
import { TicketTypesService } from './ticket-types.service';
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
    GroupsController,
    AgentsController,
    TicketTypesController,
    SlaPoliciesController,
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
    GroupsService,
    AgentsService,
    TicketTypesService,
    SlaPoliciesService,
    AutomationRulesService,
    CannedResponsesService,
    TicketTodosService,
    TicketTimeLogsService,
    DashboardService,
    AdminService,
    FreshdeskClient,
    FreshdeskMigrationService,
  ],
})
export class TicketingModule {}
