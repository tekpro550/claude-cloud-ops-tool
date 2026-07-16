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
import { DiskForecastsService } from './disk-forecasts.service';

@UseGuards(TenantHeaderGuard)
@Controller('monitoring/disk-forecasts')
export class DiskForecastsController {
  constructor(private readonly forecasts: DiskForecastsService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.forecasts.list(tenantId);
  }

  @Patch(':id/dismiss')
  dismiss(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.forecasts.dismiss(tenantId, id);
  }
}
