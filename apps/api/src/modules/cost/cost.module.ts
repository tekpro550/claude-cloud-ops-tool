import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { PlatformModule } from '../platform/platform.module';
import { CostAccountsController } from './cost-accounts.controller';
import { CostAccountsService } from './cost-accounts.service';
import { CostBillingSyncService } from './cost-billing-sync.service';
import { CostBudgetsController } from './cost-budgets.controller';
import { CostBudgetsService } from './cost-budgets.service';
import { CostPaceCheckService } from './cost-pace-check.service';

/**
 * Cost/FinOps Service boundary from section 4 of the architecture plan —
 * see docs/Cloud-Ops-Tool-Module3-Cost-FinOps-Scope.md. Imports
 * MonitoringModule only for CLOUD_PROVIDER_CLIENT_FACTORY (reused as-is,
 * not duplicated, per that doc's section 2) -- talks to the Ticketing
 * module only through its existing internal HTTP contract, never by
 * importing TicketingModule directly, the same service-boundary discipline
 * Module 2 established.
 */
@Module({
  imports: [PlatformModule, MonitoringModule, NotificationsModule],
  controllers: [CostBudgetsController, CostAccountsController],
  providers: [
    CostBudgetsService,
    CostBillingSyncService,
    CostPaceCheckService,
    CostAccountsService,
  ],
})
export class CostModule {}
