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
import { CurrentUserId } from '../platform/http/current-user.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { AgentsService } from './agents.service';
import { AddTicketMessageDto } from './dto/add-ticket-message.dto';
import { ComposeOutboundDto } from './dto/compose-outbound.dto';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { TicketsService } from './tickets.service';

@UseGuards(TenantHeaderGuard)
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly agentsService: AgentsService,
  ) {}

  @Post()
  create(@CurrentTenantId() tenantId: string, @Body() dto: CreateTicketDto) {
    return this.ticketsService.create(tenantId, dto);
  }

  @Post('compose-outbound')
  composeOutbound(
    @CurrentTenantId() tenantId: string,
    @Body() dto: ComposeOutboundDto,
  ) {
    return this.ticketsService.composeOutbound(tenantId, dto);
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
  async update(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
  ) {
    // Same "resolve the real agent from the verified login, not the request
    // body" pattern as addMessage() above -- attributes property changes in
    // the activity feed to whoever actually made them.
    let actorAgentId: string | undefined;
    if (userId) {
      const agent = await this.agentsService.findByUserId(tenantId, userId);
      if (agent) actorAgentId = agent.id;
    }
    return this.ticketsService.update(tenantId, id, dto, actorAgentId);
  }

  @Post(':id/messages')
  async addMessage(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddTicketMessageDto,
  ) {
    // A verified agent identity (real login, not just a bare X-Tenant-Id
    // header) always overrides whatever authorType/authorId the client
    // sent, both so a logged-in agent's replies/notes are correctly
    // attributed instead of falling back to "system", and so the client
    // can't spoof authorship for a different agent.
    if (userId) {
      const agent = await this.agentsService.findByUserId(tenantId, userId);
      if (agent) {
        dto = { ...dto, authorType: 'agent', authorId: agent.id };
      }
    }
    return this.ticketsService.addMessage(tenantId, id, dto);
  }

  @Get(':id/messages')
  listMessages(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ticketsService.listMessages(tenantId, id);
  }

  @Get(':id/activities')
  listActivities(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ticketsService.listActivities(tenantId, id);
  }

  @Get(':id/timeline')
  getTimeline(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ticketsService.getTimeline(tenantId, id);
  }
}
