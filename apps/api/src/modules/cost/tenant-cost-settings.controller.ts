import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { UpdateTenantCostSettingsDto } from './tenant-cost-settings.dto';
import { TenantCostSettingsService } from './tenant-cost-settings.service';

// No '/admin' prefix -- same deliberate deviation from the scope doc's
// speculative /admin/tenant_cost_settings path CostBudgetsController already
// made and documented; "admin" is a frontend page grouping, never a URL
// prefix, everywhere else in this codebase.
@UseGuards(TenantHeaderGuard)
@Controller('tenant-cost-settings')
export class TenantCostSettingsController {
  constructor(private readonly settings: TenantCostSettingsService) {}

  @Get()
  get(@CurrentTenantId() tenantId: string) {
    return this.settings.get(tenantId);
  }

  @Patch()
  update(
    @CurrentTenantId() tenantId: string,
    @Body() dto: UpdateTenantCostSettingsDto,
  ) {
    return this.settings.update(tenantId, dto);
  }
}
