import { Module } from '@nestjs/common';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { PlatformModule } from '../platform/platform.module';
import { CostBillingSyncService } from './cost-billing-sync.service';

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
  imports: [PlatformModule, MonitoringModule],
  providers: [CostBillingSyncService],
})
export class CostModule {}
