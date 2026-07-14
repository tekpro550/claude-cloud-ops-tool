import { Module } from '@nestjs/common';
import { EventBusModule } from '../../event-bus/event-bus.module';
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
import { MonitorSchedulerService } from './monitor-scheduler.service';
import { MonitorsController } from './monitors.controller';
import { MonitorsService } from './monitors.service';

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
  imports: [PlatformModule, EventBusModule],
  controllers: [
    MonitorsController,
    AlertRulesController,
    AlertsController,
    AgentTokensController,
    AgentIngestionController,
  ],
  providers: [
    MonitorsService,
    MonitorSchedulerService,
    AlertEvaluationService,
    AlertRulesService,
    AlertsService,
    AgentTokensService,
    AgentIngestionService,
    AgentTokenGuard,
  ],
})
export class MonitoringModule {}
