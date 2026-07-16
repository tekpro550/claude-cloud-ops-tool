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
import { AgentsService } from './agents.service';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { CurrentUserId } from '../platform/http/current-user.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { CreateTicketViewDto, UpdateTicketViewDto } from './ticket-views.dto';
import { TicketViewsService } from './ticket-views.service';

@UseGuards(TenantHeaderGuard)
@Controller('ticket-views')
export class TicketViewsController {
  constructor(
    private readonly ticketViews: TicketViewsService,
    private readonly agents: AgentsService,
  ) {}

  private async resolveAgentId(
    tenantId: string,
    userId: string | undefined,
  ): Promise<string | undefined> {
    if (!userId) return undefined;
    const agent = await this.agents.findByUserId(tenantId, userId);
    return agent?.id;
  }

  @Post()
  async create(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
    @Body() dto: CreateTicketViewDto,
  ) {
    const agentId = await this.resolveAgentId(tenantId, userId);
    return this.ticketViews.create(tenantId, agentId, dto);
  }

  @Get()
  async list(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
  ) {
    const agentId = await this.resolveAgentId(tenantId, userId);
    return this.ticketViews.list(tenantId, agentId);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketViewDto,
  ) {
    return this.ticketViews.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ticketViews.remove(tenantId, id);
  }
}
