import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import {
  CreateOnCallScheduleDto,
  UpdateOnCallScheduleDto,
} from './on-call-schedules.dto';
import { OnCallSchedulesService } from './on-call-schedules.service';

@UseGuards(TenantHeaderGuard)
@Controller('on-call-schedules')
export class OnCallSchedulesController {
  constructor(private readonly onCallSchedules: OnCallSchedulesService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.onCallSchedules.list(tenantId);
  }

  @Get(':id/current')
  currentOnCall(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.onCallSchedules.currentOnCall(tenantId, id);
  }

  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateOnCallScheduleDto,
  ) {
    return this.onCallSchedules.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOnCallScheduleDto,
  ) {
    return this.onCallSchedules.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.onCallSchedules.remove(tenantId, id);
  }
}
