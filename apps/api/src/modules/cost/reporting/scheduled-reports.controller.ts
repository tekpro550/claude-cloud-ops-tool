import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { Roles } from '../../platform/http/roles.decorator';
import { RolesGuard } from '../../platform/http/roles.guard';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { CreateScheduledReportDto } from './scheduled-reports.dto';
import { ScheduledReportsService } from './scheduled-reports.service';

@UseGuards(TenantHeaderGuard, RolesGuard)
@Roles('admin')
@Controller('cost/scheduled-reports')
export class ScheduledReportsController {
  constructor(private readonly scheduledReports: ScheduledReportsService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.scheduledReports.list(tenantId);
  }

  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateScheduledReportDto,
  ) {
    return this.scheduledReports.create(tenantId, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.scheduledReports.remove(tenantId, id);
  }

  @Post(':id/run-now')
  async runNow(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const file = await this.scheduledReports.runNow(tenantId, id);
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.filename.replace(/[^\x20-\x7e]/g, '_')}"`,
      'Content-Length': file.buffer.length,
    });
    res.send(file.buffer);
  }
}
