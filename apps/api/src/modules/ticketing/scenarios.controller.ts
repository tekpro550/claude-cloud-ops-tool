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
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import {
  ApplyScenarioDto,
  CreateScenarioDto,
  UpdateScenarioDto,
} from './scenarios.dto';
import { ScenariosService } from './scenarios.service';

@UseGuards(TenantHeaderGuard)
@Controller('scenarios')
export class ScenariosController {
  constructor(private readonly scenariosService: ScenariosService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.scenariosService.list(tenantId);
  }

  @Post()
  create(@CurrentTenantId() tenantId: string, @Body() dto: CreateScenarioDto) {
    return this.scenariosService.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScenarioDto,
  ) {
    return this.scenariosService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.scenariosService.remove(tenantId, id);
  }

  @Post(':id/apply')
  apply(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyScenarioDto,
  ) {
    return this.scenariosService.apply(tenantId, id, dto.ticketId);
  }
}
