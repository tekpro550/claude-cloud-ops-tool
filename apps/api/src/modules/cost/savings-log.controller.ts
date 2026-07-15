import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { ListSavingsLogQueryDto } from './savings-log.dto';
import { SavingsLogService } from './savings-log.service';

@UseGuards(TenantHeaderGuard)
@Controller('cost/savings_log')
export class SavingsLogController {
  constructor(private readonly savingsLog: SavingsLogService) {}

  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query() query: ListSavingsLogQueryDto,
  ) {
    return this.savingsLog.list(tenantId, query);
  }
}
