import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { TicketAiService } from './ticket-ai.service';
import { TicketTriageService } from './ticket-triage.service';
import { TicketSimilarService } from './ticket-similar.service';

// Distinct 'ticket-ai' prefix (not under 'tickets') so the /status route can't
// collide with the tickets ':id' param routes.
@UseGuards(TenantHeaderGuard)
@Controller('ticket-ai')
export class TicketAiController {
  constructor(
    private readonly ai: TicketAiService,
    private readonly triage: TicketTriageService,
    private readonly similar: TicketSimilarService,
  ) {}

  @Get('status')
  status(@CurrentTenantId() tenantId: string) {
    return this.ai.status(tenantId);
  }

  @Post(':id/summarize')
  summarize(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ai.summarize(tenantId, id);
  }

  @Post(':id/suggest-reply')
  suggestReply(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ai.suggestReply(tenantId, id);
  }

  @Get(':id/triage')
  getTriage(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.triage.getTriageSuggestion(tenantId, id);
  }

  @Post(':id/triage/run')
  runTriage(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    // Fire-and-forget but return immediately — caller can poll /triage
    void this.triage.triageTicket(tenantId, id);
    return { queued: true };
  }

  @Get(':id/similar')
  getSimilar(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.similar.getSimilar(tenantId, id);
  }
}
