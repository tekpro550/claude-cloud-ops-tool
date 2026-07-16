import { Module } from '@nestjs/common';
import { EventBusModule } from '../../event-bus/event-bus.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { PlatformModule } from '../platform/platform.module';
import { AgentIngestionController } from './agent-ingestion.controller';
import { AgentIngestionService } from './agent-ingestion.service';
import { AgentTokenGuard } from './agent-token.guard';
import { AgentTokensController } from './agent-tokens.controller';
import { AgentTokensService } from './agent-tokens.service';
import { AlertEvaluationService } from './alert-evaluation.service';
import { AlertRulesController } from './alert-rules.controller';
import { AlertRulesService } from './alert-rules.service';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AwsCloudProviderClient } from './cloud/aws-provider-client';
import { AzureCloudProviderClient } from './cloud/azure-provider-client';
import { CLOUD_PROVIDER_CLIENT_FACTORY } from './cloud/cloud-provider-client';
import { CloudCredentialsController } from './cloud-credentials.controller';
import { CloudCredentialsService } from './cloud-credentials.service';
import { CloudResourcePollerService } from './cloud-resource-poller.service';
import { DiskForecastSweepService } from './disk-forecast-sweep.service';
import { DiskForecastsController } from './disk-forecasts.controller';
import { DiskForecastsService } from './disk-forecasts.service';
import { DowntimeEventsController } from './downtime-events.controller';
import { DowntimeEventsService } from './downtime-events.service';
import { EscalationPoliciesController } from './escalation-policies.controller';
import { EscalationPoliciesService } from './escalation-policies.service';
import { EscalationSweepService } from './escalation-sweep.service';
import { FleetSummaryController } from './fleet-summary.controller';
import { MonitorSchedulerService } from './monitor-scheduler.service';
import { MonitoringDashboardController } from './monitoring-dashboard.controller';
import { MonitoringDashboardService } from './monitoring-dashboard.service';
import { MonitorsController } from './monitors.controller';
import { MonitorsService } from './monitors.service';
import { NotificationTemplatesController } from './notification-templates.controller';
import { NotificationTemplatesService } from './notification-templates.service';
import { OnCallSchedulesController } from './on-call-schedules.controller';
import { OnCallSchedulesService } from './on-call-schedules.service';
import { ResourcesController } from './resources.controller';
import { ResourcesService } from './resources.service';

/**
 * Monitoring Service boundary from section 4 of the architecture plan
 * (Module 2) — see docs/Cloud-Ops-Tool-Module2-Monitoring-Scope.md. Talks to
 * the Ticketing module only through its internal HTTP contract
 * (/internal/tickets/from_alert and /internal/tickets/:id/notes, see
 * AlertEvaluationService), never by importing TicketingModule directly, to
 * keep the two service boundaries decoupled the way the architecture plan
 * intends.
 */
@Module({
  imports: [PlatformModule, EventBusModule, NotificationsModule],
  controllers: [
    MonitorsController,
    AlertRulesController,
    AlertsController,
    AgentTokensController,
    AgentIngestionController,
    CloudCredentialsController,
    EscalationPoliciesController,
    OnCallSchedulesController,
    NotificationTemplatesController,
    DowntimeEventsController,
    ResourcesController,
    FleetSummaryController,
    MonitoringDashboardController,
    DiskForecastsController,
  ],
  providers: [
    ResourcesService,
    MonitorsService,
    MonitoringDashboardService,
    MonitorSchedulerService,
    AlertEvaluationService,
    AlertRulesService,
    AlertsService,
    AgentTokensService,
    AgentIngestionService,
    AgentTokenGuard,
    CloudCredentialsService,
    CloudResourcePollerService,
    EscalationPoliciesService,
    EscalationSweepService,
    OnCallSchedulesService,
    NotificationTemplatesService,
    DowntimeEventsService,
    DiskForecastsService,
    DiskForecastSweepService,
    {
      // The real AWS/Azure clients by default; verify-cloud-polling.ts
      // overrides this token with a factory that returns an in-memory fake,
      // so CloudResourcePollerService's actual logic (resource upsert,
      // threshold evaluation, alert wiring) can be verified without real
      // cloud credentials.
      provide: CLOUD_PROVIDER_CLIENT_FACTORY,
      useValue: (provider: 'aws' | 'azure', config: Record<string, unknown>) =>
        provider === 'aws'
          ? new AwsCloudProviderClient(config as any)
          : new AzureCloudProviderClient(config as any),
    },
  ],
  // CLOUD_PROVIDER_CLIENT_FACTORY is exported so Module 3 (Cost) can reuse
  // the exact same provider-client wiring for its billing sync job instead
  // of duplicating it -- see docs/Cloud-Ops-Tool-Module3-Cost-FinOps-Scope.md
  // section 2.
  exports: [CLOUD_PROVIDER_CLIENT_FACTORY],
})
export class MonitoringModule {}
