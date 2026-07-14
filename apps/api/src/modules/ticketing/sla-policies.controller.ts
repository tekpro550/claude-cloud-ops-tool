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
import { CreateSlaPolicyDto, UpdateSlaPolicyDto } from './sla-policies.dto';
import { SlaPoliciesService } from './sla-policies.service';

@UseGuards(TenantHeaderGuard)
@Controller('sla-policies')
export class SlaPoliciesController {
  constructor(private readonly slaPolicies: SlaPoliciesService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.slaPolicies.list(tenantId);
  }

  @Post()
  create(@CurrentTenantId() tenantId: string, @Body() dto: CreateSlaPolicyDto) {
    return this.slaPolicies.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSlaPolicyDto,
  ) {
    return this.slaPolicies.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.slaPolicies.remove(tenantId, id);
  }
}
