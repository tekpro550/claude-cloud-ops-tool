import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuditLogService } from '../platform/audit/audit-log.service';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { CurrentUserId } from '../platform/http/current-user.decorator';
import { Roles } from '../platform/http/roles.decorator';
import { RolesGuard } from '../platform/http/roles.guard';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { UpdateTenantCostSettingsDto } from './tenant-cost-settings.dto';
import { TenantCostSettingsService } from './tenant-cost-settings.service';

// No '/admin' prefix -- same deliberate deviation from the scope doc's
// speculative /admin/tenant_cost_settings path CostBudgetsController already
// made and documented; "admin" is a frontend page grouping, never a URL
// prefix, everywhere else in this codebase.
// Reading settings is open to any agent (the cost UI needs the FY start /
// rate display); changing them is admin-only.
@UseGuards(TenantHeaderGuard, RolesGuard)
@Controller('tenant-cost-settings')
export class TenantCostSettingsController {
  constructor(
    private readonly settings: TenantCostSettingsService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  get(@CurrentTenantId() tenantId: string) {
    return this.settings.get(tenantId);
  }

  @Roles('admin')
  @Patch()
  async update(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
    @Body() dto: UpdateTenantCostSettingsDto,
  ) {
    const result = await this.settings.update(tenantId, dto);
    await this.audit.record(tenantId, {
      actorUserId: userId,
      action: 'tenant_cost_settings.update',
      entityType: 'tenant_cost_settings',
      summary: 'Updated tenant cost settings',
      details: dto as Record<string, unknown>,
    });
    return result;
  }
}
