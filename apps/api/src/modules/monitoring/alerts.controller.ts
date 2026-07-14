import {
  Body,
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
import { LinkAlertTicketDto } from './alerts.dto';
import { AlertsService } from './alerts.service';

@UseGuards(TenantHeaderGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string, @Query('status') status?: string) {
    return this.alerts.list(tenantId, status);
  }

  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.alerts.get(tenantId, id);
  }

  @Patch(':id/ack')
  acknowledge(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.alerts.acknowledge(tenantId, id);
  }

  @Patch(':id/resolve')
  resolve(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.alerts.resolve(tenantId, id);
  }

  @Patch(':id/link_ticket')
  linkTicket(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LinkAlertTicketDto,
  ) {
    return this.alerts.linkTicket(tenantId, id, dto.ticketId);
  }
}
