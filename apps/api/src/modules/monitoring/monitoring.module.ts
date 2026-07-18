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
import { ApmController } from './apm/apm.controller';
import { ApmService } from './apm/apm.service';
import { ApmIngestionController } from './apm/apm-ingestion.controller';
import { ApmIngestTokenGuard } from './apm/apm-ingest-token.guard';
import { AwsCloudProviderClient } from './cloud/aws-provider-client';
import { AzureCloudProviderClient } from './cloud/azure-provider-client';
import {
  CLOUD_PROVIDER_CLIENT_FACTORY,
  CloudProvider,
  CloudProviderClient,
} from './cloud/cloud-provider-client';
import {
  AlibabaCloudProviderClient,
  DigitalOceanCloudProviderClient,
  GcpCloudProviderClient,
  OracleCloudProviderClient,
} from './cloud/extra-provider-clients';
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
import { LogAlertSweepService } from './logs/log-alert-sweep.service';
import { LogIngestionController } from './logs/log-ingestion.controller';
import { LogIngestionService } from './logs/log-ingestion.service';
import { LogSourceTokenGuard } from './logs/log-source-token.guard';
import { LogsController } from './logs/logs.controller';
import { LogsService } from './logs/logs.service';
import { MonitorSchedulerService } from './monitor-scheduler.service';
import { MonitoringDashboardController } from './monitoring-dashboard.controller';
import { MonitoringDashboardService } from './monitoring-dashboard.service';
import { MonitorsController } from './monitors.controller';
import { MonitorsService } from './monitors.service';
import { NotificationTemplatesController } from './notification-templates.controller';
import { NotificationTemplatesService } from './notification-templates.service';
import { OnCallSchedulesController } from './on-call-schedules.controller';
import { OnCallSchedulesService } from './on-call-schedules.service';
import { NetSnmpClient } from './network/net-snmp-client';
import { NetworkDevicesController } from './network/network-devices.controller';
import { NetworkDevicesService } from './network/network-devices.service';
import { NetworkPollerService } from './network/network-poller.service';
import { SNMP_CLIENT } from './network/snmp-client';
import { ResourcesController } from './resources.controller';
import { ResourcesService } from './resources.service';
import { RumController } from './rum/rum.controller';
import { RumService } from './rum/rum.service';
import { RumIngestionController } from './rum/rum-ingestion.controller';
import { StatusPagePublicController } from './status-pages/status-page-public.controller';
import { StatusPagesController } from './status-pages/status-pages.controller';
import { StatusPagesService } from './status-pages/status-pages.service';
import { PlaywrightSyntheticRunner } from './synthetic/playwright-synthetic-runner';
import { SYNTHETIC_RUNNER } from './synthetic/synthetic-runner';
import { SyntheticSchedulerService } from './synthetic/synthetic-scheduler.service';

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
    StatusPagesController,
    StatusPagePublicController,
    FleetSummaryController,
    MonitoringDashboardController,
    DiskForecastsController,
    LogsController,
    LogIngestionController,
    ApmController,
    ApmIngestionController,
    RumController,
    RumIngestionController,
    NetworkDevicesController,
  ],
  providers: [
    ResourcesService,
    StatusPagesService,
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
    SyntheticSchedulerService,
    {
      provide: SYNTHETIC_RUNNER,
      useClass: PlaywrightSyntheticRunner,
    },
    LogsService,
    LogIngestionService,
    LogSourceTokenGuard,
    LogAlertSweepService,
    ApmService,
    ApmIngestTokenGuard,
    RumService,
    NetworkDevicesService,
    NetworkPollerService,
    {
      provide: SNMP_CLIENT,
      useClass: NetSnmpClient,
    },
    {
      // The real per-provider clients by default; verify-cloud-polling.ts
      // overrides this token with a factory that returns an in-memory fake,
      // so CloudResourcePollerService's actual logic (resource upsert,
      // threshold evaluation, alert wiring) can be verified without real
      // cloud credentials.
      provide: CLOUD_PROVIDER_CLIENT_FACTORY,
      useValue: (
        provider: CloudProvider,
        config: Record<string, unknown>,
      ): CloudProviderClient => {
        switch (provider) {
          case 'aws':
            return new AwsCloudProviderClient(config as any);
          case 'azure':
            return new AzureCloudProviderClient(config as any);
          case 'gcp':
            return new GcpCloudProviderClient(config);
          case 'digitalocean':
            return new DigitalOceanCloudProviderClient(config);
          case 'alibaba':
            return new AlibabaCloudProviderClient();
          case 'oracle':
            return new OracleCloudProviderClient();
          default:
            throw new Error(`Unknown cloud provider: ${provider}`);
        }
      },
    },
  ],
  // CLOUD_PROVIDER_CLIENT_FACTORY is exported so Module 3 (Cost) can reuse
  // the exact same provider-client wiring for its billing sync job instead
  // of duplicating it -- see docs/Cloud-Ops-Tool-Module3-Cost-FinOps-Scope.md
  // section 2.
  exports: [CLOUD_PROVIDER_CLIENT_FACTORY],
})
export class MonitoringModule {}
