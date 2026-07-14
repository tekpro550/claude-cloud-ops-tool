import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { CurrentUserId } from '../platform/http/current-user.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { CreateDowntimeEventDto } from './downtime-events.dto';
import { DowntimeEventsService } from './downtime-events.service';

@UseGuards(TenantHeaderGuard)
@Controller('downtime-events')
export class DowntimeEventsController {
  constructor(private readonly downtimeEvents: DowntimeEventsService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.downtimeEvents.list(tenantId);
  }

  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
    @Body() dto: CreateDowntimeEventDto,
  ) {
    return this.downtimeEvents.create(tenantId, dto, userId);
  }

  @Patch(':id/end')
  end(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.downtimeEvents.end(tenantId, id);
  }
}
