import { Module } from '@nestjs/common';
import { EventBusModule } from '../../event-bus/event-bus.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PlatformModule } from '../platform/platform.module';
import { TicketAiController } from './ai/ticket-ai.controller';
import { TicketAiService } from './ai/ticket-ai.service';
import { TicketTriageService } from './ai/ticket-triage.service';
import { TicketSentimentService } from './ai/ticket-sentiment.service';
import { TicketSimilarService } from './ai/ticket-similar.service';
import { KbMiningService } from './ai/kb-mining.service';
import { KbMiningController } from './ai/kb-mining.controller';
import { KbSearchService } from './ai/kb-search.service';
import { ChatAiResponderService } from './chat/chat-ai-responder.service';
import { PortalKbController } from './portal/portal-kb.controller';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AgentSkillsController } from './assignment/agent-skills.controller';
import { AgentSkillsService } from './assignment/agent-skills.service';
import { AttachmentsController } from './attachments/attachments.controller';
import { AttachmentsService } from './attachments/attachments.service';
import { LocalDiskStorage } from './attachments/object-storage';
import { AutomationRulesController } from './automation/automation-rules.controller';
import { AutomationRulesService } from './automation/automation-rules.service';
import { AutomationRuleGenService } from './automation/automation-rule-gen.service';
import { TimeAutomationSweepService } from './automation/time-automation-sweep.service';
import { BusinessHoursSettingsController } from './business-hours-settings.controller';
import { BusinessHoursSettingsService } from './business-hours-settings.service';
import { CannedResponseFoldersController } from './canned-response-folders.controller';
import { CannedResponseFoldersService } from './canned-response-folders.service';
import { CannedResponsesController } from './canned-responses.controller';
import { CannedResponsesService } from './canned-responses.service';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { CustomFieldsController } from './custom-fields/custom-fields.controller';
import { CustomFieldsService } from './custom-fields/custom-fields.service';
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
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { ReportDefinitionsController } from './reports/report-definitions.controller';
import { ReportDefinitionsService } from './reports/report-definitions.service';
import { ReportNlService } from './reports/report-nl.service';
import { OverdueSweepService } from './sla/overdue-sweep.service';
import { SlaPoliciesController } from './sla-policies.controller';
import { SlaPoliciesService } from './sla-policies.service';
import { ChatController } from './chat/chat.controller';
import { ChatService } from './chat/chat.service';
import { SolutionsController } from './solutions.controller';
import { SolutionsService } from './solutions.service';
import { TicketLinksController } from './ticket-links/ticket-links.controller';
import { TicketLinksService } from './ticket-links/ticket-links.service';
import { TicketWatchersController } from './ticket-watchers/ticket-watchers.controller';
import { TicketWatchersService } from './ticket-watchers/ticket-watchers.service';
import { TicketPresenceController } from './ticket-presence.controller';
import { TicketPresenceService } from './ticket-presence.service';
import { TicketSatisfactionService } from './ticket-satisfaction.service';
import { TicketTimeLogsController } from './ticket-time-logs.controller';
import { TicketTimeLogsService } from './ticket-time-logs.service';
import { TicketTodosController } from './ticket-todos.controller';
import { TicketTodosService } from './ticket-todos.service';
import { TicketTypesController } from './ticket-types.controller';
import { TicketTypesService } from './ticket-types.service';
import { TicketViewsController } from './ticket-views.controller';
import { TicketViewsService } from './ticket-views.service';
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
    AgentSkillsController,
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
    ChatController,
    SolutionsController,
    AttachmentsController,
    TicketPresenceController,
    TicketViewsController,
    BusinessHoursSettingsController,
    CustomFieldsController,
    TicketLinksController,
    TicketWatchersController,
    ReportsController,
    ReportDefinitionsController,
    TicketAiController,
    KbMiningController,
    PortalKbController,
  ],
  providers: [
    TicketsService,
    EmailIntakeService,
    OverdueSweepService,
    TicketPresenceService,
    TicketViewsService,
    BusinessHoursSettingsService,
    CustomFieldsService,
    TicketSatisfactionService,
    GroupsService,
    AgentsService,
    AgentSkillsService,
    TicketTypesService,
    SlaPoliciesService,
    AutomationRulesService,
    AutomationRuleGenService,
    TimeAutomationSweepService,
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
    ChatService,
    ChatAiResponderService,
    KbSearchService,
    SolutionsService,
    AttachmentsService,
    LocalDiskStorage,
    TicketLinksService,
    TicketWatchersService,
    ReportsService,
    ReportDefinitionsService,
    ReportNlService,
    TicketAiService,
    TicketTriageService,
    TicketSentimentService,
    TicketSimilarService,
    KbMiningService,
  ],
})
export class TicketingModule {}
