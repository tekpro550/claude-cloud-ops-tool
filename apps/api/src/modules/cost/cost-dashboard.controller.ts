import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { CostDashboardService } from './cost-dashboard.service';

@UseGuards(TenantHeaderGuard)
@Controller('cost/dashboard')
export class CostDashboardController {
  constructor(private readonly dashboard: CostDashboardService) {}

  @Get('summary')
  summary(@CurrentTenantId() tenantId: string) {
    return this.dashboard.summary(tenantId);
  }

  @Get('trend')
  trend(@CurrentTenantId() tenantId: string) {
    return this.dashboard.trend(tenantId);
  }
}
