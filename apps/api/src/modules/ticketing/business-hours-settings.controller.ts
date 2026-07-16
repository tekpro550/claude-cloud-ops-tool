import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
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
  constructor(private readonly settings: BusinessHoursSettingsService) {}

  @Get()
  get(@CurrentTenantId() tenantId: string) {
    return this.settings.get(tenantId);
  }

  @Roles('admin')
  @Patch()
  update(
    @CurrentTenantId() tenantId: string,
    @Body() dto: UpdateBusinessHoursDto,
  ) {
    return this.settings.update(tenantId, dto);
  }
}
