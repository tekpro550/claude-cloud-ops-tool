import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { ResourcesService } from './resources.service';

@UseGuards(TenantHeaderGuard)
@Controller('monitoring')
export class FleetSummaryController {
  constructor(private readonly resources: ResourcesService) {}

  @Get('fleet_summary')
  fleetSummary(@CurrentTenantId() tenantId: string) {
    return this.resources.fleetSummary(tenantId);
  }
}
