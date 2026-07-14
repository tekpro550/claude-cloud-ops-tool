import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { CreateTicketTimeLogDto } from './ticket-time-logs.dto';
import { TicketTimeLogsService } from './ticket-time-logs.service';

@UseGuards(TenantHeaderGuard)
@Controller('tickets/:ticketId/time-logs')
export class TicketTimeLogsController {
  constructor(private readonly ticketTimeLogs: TicketTimeLogsService) {}

  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: CreateTicketTimeLogDto,
  ) {
    return this.ticketTimeLogs.create(tenantId, ticketId, dto);
  }

  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.ticketTimeLogs.list(tenantId, ticketId);
  }

  @Delete(':logId')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Param('logId', ParseUUIDPipe) logId: string,
  ) {
    return this.ticketTimeLogs.remove(tenantId, ticketId, logId);
  }
}
