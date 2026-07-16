import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { CostAnomaliesService } from './cost-anomalies.service';

@UseGuards(TenantHeaderGuard)
@Controller('cost/anomalies')
export class CostAnomaliesController {
  constructor(private readonly anomalies: CostAnomaliesService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.anomalies.list(tenantId);
  }

  @Patch(':id/dismiss')
  dismiss(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.anomalies.dismiss(tenantId, id);
  }
}
