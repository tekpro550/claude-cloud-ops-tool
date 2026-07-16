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
import { RateTicketDto } from '../ticket-satisfaction.dto';
import { TicketSatisfactionService } from '../ticket-satisfaction.service';
import { CurrentContactId } from './current-contact.decorator';
import { PortalAuthGuard } from './portal-auth.guard';
import { PortalSubmitTicketDto } from './portal-tickets.dto';
import { PortalTicketsService } from './portal-tickets.service';

@Controller('portal/tickets')
export class PortalTicketsController {
  constructor(
    private readonly portalTickets: PortalTicketsService,
    private readonly satisfaction: TicketSatisfactionService,
  ) {}

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

  @UseGuards(PortalAuthGuard)
  @Get(':id/satisfaction')
  async getSatisfaction(
    @CurrentTenantId() tenantId: string,
    @CurrentContactId() contactId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    // Confirms the ticket belongs to this contact (404s otherwise) before
    // returning the rating, matching getForContact's ownership check.
    await this.portalTickets.getForContact(tenantId, contactId, id);
    return this.satisfaction.getForTicket(tenantId, id);
  }

  @UseGuards(PortalAuthGuard)
  @Post(':id/satisfaction')
  rate(
    @CurrentTenantId() tenantId: string,
    @CurrentContactId() contactId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RateTicketDto,
  ) {
    return this.satisfaction.rate(tenantId, contactId, id, dto);
  }
}
