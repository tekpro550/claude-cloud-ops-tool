import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { PlatformModule } from '../platform/platform.module';
import { CostAccountsController } from './cost-accounts.controller';
import { CostAccountsService } from './cost-accounts.service';
import { CostAllocationController } from './cost-allocation.controller';
import { CostAllocationService } from './cost-allocation.service';
import { CostAnomaliesController } from './cost-anomalies.controller';
import { CostAnomaliesService } from './cost-anomalies.service';
import { CostNarrativeService } from './cost-narrative.service';
import { RightsizingRationaleService } from './rightsizing-rationale.service';
import { CostAnomalyCheckService } from './cost-anomaly-check.service';
import { CostBillingSyncService } from './cost-billing-sync.service';
import { CostBudgetsController } from './cost-budgets.controller';
import { CostBudgetsService } from './cost-budgets.service';
import { CostDashboardController } from './cost-dashboard.controller';
import { CostDashboardService } from './cost-dashboard.service';
import { CostPaceCheckService } from './cost-pace-check.service';
import { CommitmentSweepService } from './commitments/commitment-sweep.service';
import { CommitmentsController } from './commitments/commitments.controller';
import { CommitmentsService } from './commitments/commitments.service';
import { CostSavingsSweepService } from './cost-savings-sweep.service';
import { RecommendationsController } from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';
import { ReportGeneratorService } from './reporting/report-generator.service';
import { ScheduledReportSweepService } from './reporting/scheduled-report-sweep.service';
import { ScheduledReportsController } from './reporting/scheduled-reports.controller';
import { ScheduledReportsService } from './reporting/scheduled-reports.service';
import { RightsizingSweepService } from './rightsizing-sweep.service';
import { SavingsLogController } from './savings-log.controller';
import { SavingsLogService } from './savings-log.service';
import { TenantCostSettingsController } from './tenant-cost-settings.controller';
import { TenantCostSettingsService } from './tenant-cost-settings.service';

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
  controllers: [
    CostBudgetsController,
    CostAccountsController,
    RecommendationsController,
    SavingsLogController,
    TenantCostSettingsController,
    CostDashboardController,
    CostAnomaliesController,
    CostAllocationController,
    CommitmentsController,
    ScheduledReportsController,
  ],
  providers: [
    CostBudgetsService,
    CostBillingSyncService,
    CostPaceCheckService,
    CostAnomalyCheckService,
    CostAnomaliesService,
    CostAccountsService,
    RightsizingSweepService,
    RightsizingRationaleService,
    RecommendationsService,
    CostSavingsSweepService,
    CostNarrativeService,
    SavingsLogService,
    TenantCostSettingsService,
    CostDashboardService,
    CostAllocationService,
    CommitmentsService,
    CommitmentSweepService,
    ReportGeneratorService,
    ScheduledReportsService,
    ScheduledReportSweepService,
  ],
})
export class CostModule {}
