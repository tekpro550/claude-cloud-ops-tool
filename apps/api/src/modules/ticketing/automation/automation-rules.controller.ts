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
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import {
  CreateAutomationRuleDto,
  UpdateAutomationRuleDto,
} from './automation-rules.dto';
import { AutomationRulesService } from './automation-rules.service';

@UseGuards(TenantHeaderGuard)
@Controller('automation-rules')
export class AutomationRulesController {
  constructor(private readonly automationRules: AutomationRulesService) {}

  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateAutomationRuleDto,
  ) {
    return this.automationRules.create(tenantId, dto);
  }

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.automationRules.list(tenantId);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAutomationRuleDto,
  ) {
    return this.automationRules.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.automationRules.remove(tenantId, id);
  }
}
