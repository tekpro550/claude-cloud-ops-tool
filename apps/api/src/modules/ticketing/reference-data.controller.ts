import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { ReferenceDataService } from './reference-data.service';

@UseGuards(TenantHeaderGuard)
@Controller()
export class ReferenceDataController {
  constructor(private readonly referenceData: ReferenceDataService) {}

  @Get('groups')
  listGroups(@CurrentTenantId() tenantId: string) {
    return this.referenceData.listGroups(tenantId);
  }

  @Get('agents')
  listAgents(@CurrentTenantId() tenantId: string) {
    return this.referenceData.listAgents(tenantId);
  }

  @Get('ticket-types')
  listTicketTypes(@CurrentTenantId() tenantId: string) {
    return this.referenceData.listTicketTypes(tenantId);
  }
}
