import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { CurrentUserId } from '../../platform/http/current-user.decorator';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { SearchScope, SearchService } from './search.service';

const VALID_SCOPES: SearchScope[] = [
  'all',
  'tickets',
  'contacts',
  'companies',
  'solutions',
];

@UseGuards(TenantHeaderGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
    @Query('q') q: string,
    @Query('scope') scope?: string,
  ) {
    const resolvedScope: SearchScope = VALID_SCOPES.includes(
      scope as SearchScope,
    )
      ? (scope as SearchScope)
      : 'all';
    // A verified agent identity (a valid Bearer JWT, not just a bare
    // X-Tenant-Id header) sees drafts; a header-only caller only sees
    // published solutions, same as the portal's public browsing.
    return this.searchService.search(
      tenantId,
      q ?? '',
      resolvedScope,
      !userId,
    );
  }
}
