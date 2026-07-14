import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { SearchScope, SearchService } from './search.service';

const VALID_SCOPES: SearchScope[] = ['all', 'tickets', 'contacts', 'companies'];

@UseGuards(TenantHeaderGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(
    @CurrentTenantId() tenantId: string,
    @Query('q') q: string,
    @Query('scope') scope?: string,
  ) {
    const resolvedScope: SearchScope = VALID_SCOPES.includes(
      scope as SearchScope,
    )
      ? (scope as SearchScope)
      : 'all';
    return this.searchService.search(tenantId, q ?? '', resolvedScope);
  }
}
