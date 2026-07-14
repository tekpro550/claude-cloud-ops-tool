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
import { CreateAlertRuleDto, UpdateAlertRuleDto } from './alert-rules.dto';
import { AlertRulesService } from './alert-rules.service';

@UseGuards(TenantHeaderGuard)
@Controller('alert-rules')
export class AlertRulesController {
  constructor(private readonly alertRules: AlertRulesService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.alertRules.list(tenantId);
  }

  @Post()
  create(@CurrentTenantId() tenantId: string, @Body() dto: CreateAlertRuleDto) {
    return this.alertRules.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAlertRuleDto,
  ) {
    return this.alertRules.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.alertRules.remove(tenantId, id);
  }
}
