import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { MonitoringDashboardService } from './monitoring-dashboard.service';

@UseGuards(TenantHeaderGuard)
@Controller('monitoring/dashboard')
export class MonitoringDashboardController {
  constructor(private readonly dashboard: MonitoringDashboardService) {}

  @Get('summary')
  summary(@CurrentTenantId() tenantId: string) {
    return this.dashboard.summary(tenantId);
  }

  @Get('trends')
  trends(@CurrentTenantId() tenantId: string, @Query('days') days?: string) {
    const parsed = Math.min(Math.max(Number(days) || 14, 1), 90);
    return this.dashboard.trends(tenantId, parsed);
  }
}
