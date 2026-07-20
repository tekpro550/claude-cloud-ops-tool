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
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { CreateMonitorDto, UpdateMonitorDto } from './monitors.dto';
import { MonitorsService } from './monitors.service';
import { SyntheticScriptGenService } from './synthetic/synthetic-script-gen.service';

class GenerateScriptBodyDto {
  description: string;
}

@UseGuards(TenantHeaderGuard)
@Controller('monitors')
export class MonitorsController {
  constructor(
    private readonly monitors: MonitorsService,
    private readonly scriptGen: SyntheticScriptGenService,
  ) {}

  @Post('synthetic/generate')
  generateSyntheticScript(
    @CurrentTenantId() tenantId: string,
    @Body() dto: GenerateScriptBodyDto,
  ) {
    return this.scriptGen.generateScript(tenantId, dto.description);
  }

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.monitors.list(tenantId);
  }

  @Get(':id')
  get(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.monitors.get(tenantId, id);
  }

  @Get(':id/checks')
  checks(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return this.monitors.checks(tenantId, id, parsed);
  }

  @Post()
  create(@CurrentTenantId() tenantId: string, @Body() dto: CreateMonitorDto) {
    return this.monitors.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMonitorDto,
  ) {
    return this.monitors.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.monitors.remove(tenantId, id);
  }
}
