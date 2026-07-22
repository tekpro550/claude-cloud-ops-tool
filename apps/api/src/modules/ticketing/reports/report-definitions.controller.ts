import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { CurrentUserId } from '../../platform/http/current-user.decorator';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import {
  ReportConfigDto,
  CreateReportDefinitionDto,
} from './report-definitions.dto';
import { ReportDefinitionsService } from './report-definitions.service';
import { ReportNlService } from './report-nl.service';

class NlReportQuestionDto {
  @IsString()
  @MaxLength(2000)
  question: string;
}

@UseGuards(TenantHeaderGuard)
@Controller('reports/custom')
export class ReportDefinitionsController {
  constructor(
    private readonly definitions: ReportDefinitionsService,
    private readonly nl: ReportNlService,
  ) {}

  /**
   * Translate a plain-English question into a validated ReportConfig draft
   * (allowlist-gated via buildReportQuery). Returns the config only — the
   * admin previews/saves it through the existing endpoints.
   */
  @Post('nl')
  buildFromNl(
    @CurrentTenantId() tenantId: string,
    @Body() dto: NlReportQuestionDto,
  ) {
    return this.nl.buildConfig(tenantId, dto.question);
  }

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.definitions.list(tenantId);
  }

  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
    @Body() dto: CreateReportDefinitionDto,
  ) {
    return this.definitions.create(tenantId, dto, userId);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.definitions.remove(tenantId, id);
  }

  @Post('preview')
  preview(
    @CurrentTenantId() tenantId: string,
    @Body() config: ReportConfigDto,
  ) {
    return this.definitions.preview(tenantId, config);
  }

  @Post(':id/run')
  run(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.definitions.run(tenantId, id);
  }
}
