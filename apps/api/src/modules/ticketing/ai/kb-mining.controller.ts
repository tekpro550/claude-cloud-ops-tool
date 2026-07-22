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
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { KbSearchService } from './kb-search.service';
import {
  KbDraftArticleDto,
  KbMiningService,
  UpdateKbArticleDto,
} from './kb-mining.service';

class DraftArticleBodyDto implements KbDraftArticleDto {
  ticketIds: string[];
  agentId?: string;
}

class UpdateArticleBodyDto implements UpdateKbArticleDto {
  title?: string;
  bodyMd?: string;
  status?: 'draft' | 'published' | 'archived';
  tags?: string[];
}

@UseGuards(TenantHeaderGuard)
@Controller('kb-articles')
export class KbMiningController {
  constructor(
    private readonly kb: KbMiningService,
    private readonly kbSearch: KbSearchService,
  ) {}

  /** Agent-facing search of published KB articles (pg_trgm + optional AI re-rank). */
  @Get('search')
  search(@CurrentTenantId() tenantId: string, @Query('q') q: string) {
    return this.kbSearch.searchPublished(tenantId, q ?? '', 5);
  }

  @Get('clusters')
  suggestClusters(@CurrentTenantId() tenantId: string) {
    return this.kb.suggestClusters(tenantId);
  }

  @Post('draft')
  draftArticle(
    @CurrentTenantId() tenantId: string,
    @Body() dto: DraftArticleBodyDto,
  ) {
    return this.kb.draftArticle(tenantId, dto);
  }

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.kb.list(tenantId);
  }

  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.kb.get(tenantId, id);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateArticleBodyDto,
  ) {
    return this.kb.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.kb.remove(tenantId, id);
  }
}
