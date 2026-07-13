import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { AddTicketMessageDto } from './dto/add-ticket-message.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketsService } from './tickets.service';

@UseGuards(TenantHeaderGuard)
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  create(@CurrentTenantId() tenantId: string, @Body() dto: CreateTicketDto) {
    return this.ticketsService.create(tenantId, dto);
  }

  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query() query: ListTicketsQueryDto,
  ) {
    return this.ticketsService.list(tenantId, query);
  }

  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ticketsService.get(tenantId, id);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
  ) {
    return this.ticketsService.update(tenantId, id, dto);
  }

  @Post(':id/messages')
  addMessage(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddTicketMessageDto,
  ) {
    return this.ticketsService.addMessage(tenantId, id, dto);
  }
}
