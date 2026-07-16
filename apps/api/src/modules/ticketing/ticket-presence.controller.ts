import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AgentsService } from './agents.service';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { CurrentUserId } from '../platform/http/current-user.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { HeartbeatDto } from './ticket-presence.dto';
import { TicketPresenceService } from './ticket-presence.service';

/**
 * Collision detection only tracks real, verified agent identities (a JWT
 * login, resolved to an agents row) -- a bare X-Tenant-Id request has no
 * distinguishable "who", so both endpoints degrade to a no-op/empty result
 * rather than tracking or exposing anonymous presence.
 */
@UseGuards(TenantHeaderGuard)
@Controller('tickets/:id/presence')
export class TicketPresenceController {
  constructor(
    private readonly presence: TicketPresenceService,
    private readonly agents: AgentsService,
  ) {}

  @Post()
  @HttpCode(204)
  async heartbeat(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
    @Param('id', ParseUUIDPipe) ticketId: string,
    @Body() dto: HeartbeatDto,
  ): Promise<void> {
    if (!userId) return;
    const agent = await this.agents.findByUserId(tenantId, userId);
    if (!agent) return;
    await this.presence.heartbeat(
      tenantId,
      ticketId,
      agent.id,
      dto.isTyping ?? false,
    );
  }

  @Get()
  async list(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
    @Param('id', ParseUUIDPipe) ticketId: string,
  ) {
    let selfAgentId: string | undefined;
    if (userId) {
      const agent = await this.agents.findByUserId(tenantId, userId);
      selfAgentId = agent?.id;
    }
    return this.presence.list(tenantId, ticketId, selfAgentId);
  }
}
