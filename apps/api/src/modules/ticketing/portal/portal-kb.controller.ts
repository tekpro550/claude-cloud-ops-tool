import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { KbSearchService } from '../ai/kb-search.service';

/**
 * Customer-portal knowledge-base deflection. A visitor typing a ticket subject
 * hits this to see relevant published articles BEFORE submitting — potentially
 * self-serving and deflecting the ticket. TenantHeaderGuard (not
 * PortalAuthGuard) because deflection happens on the pre-submit form, same as
 * the unauthenticated portal ticket-create path. Only published articles and
 * a title/snippet are ever returned.
 */
@UseGuards(TenantHeaderGuard)
@Controller('portal/kb')
export class PortalKbController {
  constructor(private readonly kbSearch: KbSearchService) {}

  @Get('search')
  search(@CurrentTenantId() tenantId: string, @Query('q') q: string) {
    return this.kbSearch.searchPublished(tenantId, q ?? '', 3);
  }
}
