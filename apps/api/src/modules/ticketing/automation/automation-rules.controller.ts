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
import { AuditLogService } from '../../platform/audit/audit-log.service';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { CurrentUserId } from '../../platform/http/current-user.decorator';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { IsString, MaxLength } from 'class-validator';
import {
  CreateAutomationRuleDto,
  UpdateAutomationRuleDto,
} from './automation-rules.dto';
import { AutomationRulesService } from './automation-rules.service';
import { AutomationRuleGenService } from './automation-rule-gen.service';

class GenerateRuleDto {
  @IsString()
  @MaxLength(2000)
  description: string;
}

@UseGuards(TenantHeaderGuard)
@Controller('automation-rules')
export class AutomationRulesController {
  constructor(
    private readonly automationRules: AutomationRulesService,
    private readonly ruleGen: AutomationRuleGenService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Draft a rule from a plain-English description. Returns the draft only —
   * the admin reviews it and saves via the normal POST /automation-rules.
   */
  @Post('generate')
  generate(@CurrentTenantId() tenantId: string, @Body() dto: GenerateRuleDto) {
    return this.ruleGen.generateRule(tenantId, dto.description);
  }

  @Post()
  async create(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
    @Body() dto: CreateAutomationRuleDto,
  ) {
    const rule = await this.automationRules.create(tenantId, dto);
    await this.audit.record(tenantId, {
      actorUserId: userId,
      action: 'automation_rule.create',
      entityType: 'automation_rule',
      entityId: rule.id,
      summary: `Created automation rule "${rule.name}"`,
      details: { trigger: rule.trigger },
    });
    return rule;
  }

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.automationRules.list(tenantId);
  }

  @Patch(':id')
  async update(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAutomationRuleDto,
  ) {
    const rule = await this.automationRules.update(tenantId, id, dto);
    await this.audit.record(tenantId, {
      actorUserId: userId,
      action: 'automation_rule.update',
      entityType: 'automation_rule',
      entityId: id,
      summary: `Updated automation rule "${rule?.name ?? id}"`,
    });
    return rule;
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.automationRules.remove(tenantId, id);
    await this.audit.record(tenantId, {
      actorUserId: userId,
      action: 'automation_rule.delete',
      entityType: 'automation_rule',
      entityId: id,
      summary: `Deleted automation rule ${id}`,
    });
  }
}
