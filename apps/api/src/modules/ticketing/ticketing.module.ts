import { Module } from '@nestjs/common';
import { EventBusModule } from '../../event-bus/event-bus.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PlatformModule } from '../platform/platform.module';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AttachmentsController } from './attachments/attachments.controller';
import { AttachmentsService } from './attachments/attachments.service';
import { LocalDiskStorage } from './attachments/object-storage';
import { AutomationRulesController } from './automation/automation-rules.controller';
import { AutomationRulesService } from './automation/automation-rules.service';
import { CannedResponseFoldersController } from './canned-response-folders.controller';
import { CannedResponseFoldersService } from './canned-response-folders.service';
import { CannedResponsesController } from './canned-responses.controller';
import { CannedResponsesService } from './canned-responses.service';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { EmailIntakeService } from './email-intake/email-intake.service';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { InternalTicketsController } from './internal/internal-tickets.controller';
import { FreshdeskClient } from './migration/freshdesk-client';
import { FreshdeskMigrationService } from './migration/freshdesk-migration.service';
import { PortalAuthController } from './portal/portal-auth.controller';
import { PortalAuthService } from './portal/portal-auth.service';
import { PortalSolutionsController } from './portal/portal-solutions.controller';
import { PortalTicketsController } from './portal/portal-tickets.controller';
import { PortalTicketsService } from './portal/portal-tickets.service';
import { ScenariosController } from './scenarios.controller';
import { ScenariosService } from './scenarios.service';
import { SearchController } from './search/search.controller';
import { SearchService } from './search/search.service';
import { OverdueSweepService } from './sla/overdue-sweep.service';
import { SlaPoliciesController } from './sla-policies.controller';
import { SlaPoliciesService } from './sla-policies.service';
import { SolutionsController } from './solutions.controller';
import { SolutionsService } from './solutions.service';
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
    CannedResponseFoldersController,
    ContactsController,
    CompaniesController,
    ScenariosController,
    SearchController,
    TicketTodosController,
    TicketTimeLogsController,
    DashboardController,
    AdminController,
    InternalTicketsController,
    PortalAuthController,
    PortalTicketsController,
    PortalSolutionsController,
    SolutionsController,
    AttachmentsController,
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
    CannedResponseFoldersService,
    ContactsService,
    CompaniesService,
    ScenariosService,
    SearchService,
    TicketTodosService,
    TicketTimeLogsService,
    DashboardService,
    AdminService,
    FreshdeskClient,
    FreshdeskMigrationService,
    PortalAuthService,
    PortalTicketsService,
    SolutionsService,
    AttachmentsService,
    LocalDiskStorage,
  ],
})
export class TicketingModule {}
