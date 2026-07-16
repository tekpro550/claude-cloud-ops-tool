import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { CurrentUserId } from '../../platform/http/current-user.decorator';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { AgentsService } from '../agents.service';
import { TicketWatchersService } from './ticket-watchers.service';

@UseGuards(TenantHeaderGuard)
@Controller('tickets/:ticketId/watchers')
export class TicketWatchersController {
  constructor(
    private readonly watchers: TicketWatchersService,
    private readonly agents: AgentsService,
  ) {}

  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.watchers.list(tenantId, ticketId);
  }

  // Watch as the logged-in agent. Requires a real agent identity (JWT), not a
  // bare tenant header -- there's no agent to attach otherwise.
  @Post()
  async watch(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    const agentId = await this.resolveAgent(tenantId, userId);
    return this.watchers.watch(tenantId, ticketId, agentId);
  }

  @Delete()
  async unwatch(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    const agentId = await this.resolveAgent(tenantId, userId);
    return this.watchers.unwatch(tenantId, ticketId, agentId);
  }

  private async resolveAgent(
    tenantId: string,
    userId: string | undefined,
  ): Promise<string> {
    if (!userId) {
      throw new BadRequestException(
        'Watching a ticket requires a signed-in agent',
      );
    }
    const agent = await this.agents.findByUserId(tenantId, userId);
    if (!agent) {
      throw new BadRequestException('No agent profile for the current user');
    }
    return agent.id;
  }
}
