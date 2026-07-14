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
  CreateEscalationPolicyDto,
  UpdateEscalationPolicyDto,
} from './escalation-policies.dto';
import { EscalationPoliciesService } from './escalation-policies.service';

@UseGuards(TenantHeaderGuard)
@Controller('escalation-policies')
export class EscalationPoliciesController {
  constructor(private readonly escalationPolicies: EscalationPoliciesService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.escalationPolicies.list(tenantId);
  }

  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateEscalationPolicyDto,
  ) {
    return this.escalationPolicies.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEscalationPolicyDto,
  ) {
    return this.escalationPolicies.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.escalationPolicies.remove(tenantId, id);
  }
}
