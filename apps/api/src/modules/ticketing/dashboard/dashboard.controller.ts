import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { DashboardService } from './dashboard.service';

@UseGuards(TenantHeaderGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  summary(@CurrentTenantId() tenantId: string) {
    return this.dashboard.summary(tenantId);
  }

  @Get('trends')
  trends(@CurrentTenantId() tenantId: string, @Query('days') days?: string) {
    const parsed = Math.min(Math.max(Number(days) || 14, 1), 90);
    return this.dashboard.trends(tenantId, parsed);
  }

  @Get('sla-summary')
  slaSummary(@CurrentTenantId() tenantId: string) {
    return this.dashboard.slaSummary(tenantId);
  }

  @Get('needs-attention')
  needsAttention(@CurrentTenantId() tenantId: string) {
    return this.dashboard.needsAttention(tenantId);
  }
}
