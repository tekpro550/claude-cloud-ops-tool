import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuditLogService } from '../platform/audit/audit-log.service';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { CurrentUserId } from '../platform/http/current-user.decorator';
import { Roles } from '../platform/http/roles.decorator';
import { RolesGuard } from '../platform/http/roles.guard';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { UpdateBusinessHoursDto } from './business-hours-settings.dto';
import { BusinessHoursSettingsService } from './business-hours-settings.service';

// Reading business hours is open (the SLA UI shows them); changing them is
// admin-only, same split as tenant cost settings.
@UseGuards(TenantHeaderGuard, RolesGuard)
@Controller('business-hours')
export class BusinessHoursSettingsController {
  constructor(
    private readonly settings: BusinessHoursSettingsService,
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
    @Body() dto: UpdateBusinessHoursDto,
  ) {
    const result = await this.settings.update(tenantId, dto);
    await this.audit.record(tenantId, {
      actorUserId: userId,
      action: 'business_hours.update',
      entityType: 'business_hours',
      summary: 'Updated business hours for SLA calculation',
      details: dto as Record<string, unknown>,
    });
    return result;
  }
}
