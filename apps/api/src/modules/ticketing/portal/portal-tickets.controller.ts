import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { CurrentContactId } from './current-contact.decorator';
import { PortalAuthGuard } from './portal-auth.guard';
import { PortalSubmitTicketDto } from './portal-tickets.dto';
import { PortalTicketsService } from './portal-tickets.service';

@Controller('portal/tickets')
export class PortalTicketsController {
  constructor(private readonly portalTickets: PortalTicketsService) {}

  @UseGuards(TenantHeaderGuard)
  @Post()
  submit(
    @CurrentTenantId() tenantId: string,
    @Body() dto: PortalSubmitTicketDto,
  ) {
    return this.portalTickets.submit(tenantId, dto);
  }

  @UseGuards(PortalAuthGuard)
  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @CurrentContactId() contactId: string,
  ) {
    return this.portalTickets.listForContact(tenantId, contactId);
  }

  @UseGuards(PortalAuthGuard)
  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @CurrentContactId() contactId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.portalTickets.getForContact(tenantId, contactId, id);
  }
}
