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
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { CreateTicketLinkDto } from './ticket-links.dto';
import { TicketLinksService } from './ticket-links.service';

@UseGuards(TenantHeaderGuard)
@Controller('tickets/:ticketId/links')
export class TicketLinksController {
  constructor(private readonly links: TicketLinksService) {}

  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.links.list(tenantId, ticketId);
  }

  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: CreateTicketLinkDto,
  ) {
    return this.links.create(tenantId, ticketId, dto);
  }

  @Delete(':linkId')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('ticketId', ParseUUIDPipe) _ticketId: string,
    @Param('linkId', ParseUUIDPipe) linkId: string,
  ) {
    return this.links.remove(tenantId, linkId);
  }
}
