import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { CostAnomaliesService } from './cost-anomalies.service';
import { CostNarrativeService } from './cost-narrative.service';

@UseGuards(TenantHeaderGuard)
@Controller('cost/anomalies')
export class CostAnomaliesController {
  constructor(
    private readonly anomalies: CostAnomaliesService,
    private readonly narrative: CostNarrativeService,
  ) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.anomalies.list(tenantId);
  }

  @Get('narrative')
  getNarrative(
    @CurrentTenantId() tenantId: string,
    @Query('cloudCredentialId') cloudCredentialId?: string,
  ) {
    return this.narrative.getNarrative(tenantId, cloudCredentialId);
  }

  @Patch(':id/dismiss')
  dismiss(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.anomalies.dismiss(tenantId, id);
  }
}
