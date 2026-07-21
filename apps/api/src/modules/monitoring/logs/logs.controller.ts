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
import {
  CreateLogAlertRuleDto,
  CreateLogSourceDto,
  UpdateLogAlertRuleDto,
  UpdateLogSourceDto,
} from './logs.dto';
import { LogsService } from './logs.service';
import { LogNlSearchService } from './log-nl-search.service';

class NlSearchBodyDto {
  query: string;
}

@UseGuards(TenantHeaderGuard)
@Controller('logs')
export class LogsController {
  constructor(
    private readonly logs: LogsService,
    private readonly nlSearch: LogNlSearchService,
  ) {}

  @Post('search/nl')
  searchNl(@CurrentTenantId() tenantId: string, @Body() dto: NlSearchBodyDto) {
    return this.nlSearch.nlSearch(tenantId, dto.query);
  }

  @Get('search')
  search(
    @CurrentTenantId() tenantId: string,
    @Query('sourceId') sourceId?: string,
    @Query('level') level?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.logs.search(tenantId, {
      sourceId,
      level,
      q,
      from,
      to,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('sources')
  listSources(@CurrentTenantId() tenantId: string) {
    return this.logs.listSources(tenantId);
  }

  @Post('sources')
  createSource(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateLogSourceDto,
  ) {
    return this.logs.createSource(tenantId, dto);
  }

  @Patch('sources/:id')
  updateSource(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLogSourceDto,
  ) {
    return this.logs.updateSource(tenantId, id, dto);
  }

  @Delete('sources/:id')
  @HttpCode(204)
  removeSource(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.logs.removeSource(tenantId, id);
  }

  @Get('alert-rules')
  listAlertRules(@CurrentTenantId() tenantId: string) {
    return this.logs.listAlertRules(tenantId);
  }

  @Post('alert-rules')
  createAlertRule(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateLogAlertRuleDto,
  ) {
    return this.logs.createAlertRule(tenantId, dto);
  }

  @Patch('alert-rules/:id')
  updateAlertRule(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLogAlertRuleDto,
  ) {
    return this.logs.updateAlertRule(tenantId, id, dto);
  }

  @Delete('alert-rules/:id')
  @HttpCode(204)
  removeAlertRule(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.logs.removeAlertRule(tenantId, id);
  }
}
