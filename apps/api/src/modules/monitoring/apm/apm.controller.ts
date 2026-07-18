import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { CreateApmIngestKeyDto } from './apm.dto';
import { ApmService } from './apm.service';

@UseGuards(TenantHeaderGuard)
@Controller('apm')
export class ApmController {
  constructor(private readonly apm: ApmService) {}

  @Get('ingest-keys')
  listIngestKeys(@CurrentTenantId() tenantId: string) {
    return this.apm.listIngestKeys(tenantId);
  }

  @Post('ingest-keys')
  createIngestKey(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateApmIngestKeyDto,
  ) {
    return this.apm.createIngestKey(tenantId, dto);
  }

  @Delete('ingest-keys/:id')
  @HttpCode(204)
  removeIngestKey(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.apm.removeIngestKey(tenantId, id);
  }

  @Get('services')
  listServices(@CurrentTenantId() tenantId: string) {
    return this.apm.listServices(tenantId);
  }

  @Get('services/:service/stats')
  serviceStats(
    @CurrentTenantId() tenantId: string,
    @Param('service') service: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.apm.serviceStats(tenantId, service, { from, to });
  }

  @Get('services/:service/slowest-traces')
  slowestTraces(
    @CurrentTenantId() tenantId: string,
    @Param('service') service: string,
    @Query('limit') limit?: string,
  ) {
    return this.apm.slowestTraces(
      tenantId,
      service,
      limit ? Number(limit) : undefined,
    );
  }

  @Get('traces/:id')
  getTrace(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.apm.getTraceWithSpans(tenantId, id);
  }
}
