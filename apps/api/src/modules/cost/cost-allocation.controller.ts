import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { AllocationQueryDto } from './cost-allocation.dto';
import { CostAllocationService } from './cost-allocation.service';

@UseGuards(TenantHeaderGuard)
@Controller('cost/allocation')
export class CostAllocationController {
  constructor(private readonly allocation: CostAllocationService) {}

  @Get('tag-keys')
  tagKeys(@CurrentTenantId() tenantId: string) {
    return this.allocation.tagKeys(tenantId);
  }

  @Get()
  byTag(
    @CurrentTenantId() tenantId: string,
    @Query() query: AllocationQueryDto,
  ) {
    return this.allocation.allocationByTag(tenantId, query.tagKey, {
      from: query.from,
      to: query.to,
    });
  }
}
