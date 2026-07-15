import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { CostAccountsService } from './cost-accounts.service';
import { ListLineItemsQueryDto } from './cost-accounts.dto';

@UseGuards(TenantHeaderGuard)
@Controller('cost')
export class CostAccountsController {
  constructor(private readonly costAccounts: CostAccountsService) {}

  @Get('accounts_summary')
  accountsSummary(@CurrentTenantId() tenantId: string) {
    return this.costAccounts.accountsSummary(tenantId);
  }

  @Get('accounts/:credentialId/summary')
  accountSummary(
    @CurrentTenantId() tenantId: string,
    @Param('credentialId', ParseUUIDPipe) credentialId: string,
  ) {
    return this.costAccounts.accountSummary(tenantId, credentialId);
  }

  @Get('accounts/:credentialId/line_items')
  lineItems(
    @CurrentTenantId() tenantId: string,
    @Param('credentialId', ParseUUIDPipe) credentialId: string,
    @Query() query: ListLineItemsQueryDto,
  ) {
    return this.costAccounts.lineItems(tenantId, credentialId, query);
  }
}
