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

// Distinct 'ticket-ai' prefix (not under 'tickets') so the /status route can't
// collide with the tickets ':id' param routes.
@UseGuards(TenantHeaderGuard)
@Controller('ticket-ai')
export class TicketAiController {
  constructor(private readonly ai: TicketAiService) {}

  @Get('status')
  status() {
    return this.ai.status();
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
}
