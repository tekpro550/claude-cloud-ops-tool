import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../platform/http/current-tenant.decorator';
import { Roles } from '../platform/http/roles.decorator';
import { RolesGuard } from '../platform/http/roles.guard';
import { TenantHeaderGuard } from '../platform/http/tenant-header.guard';
import { CreateAgentDto, UpdateAgentDto } from './agents.dto';
import { AgentsService } from './agents.service';

// Listing agents stays open (assignment dropdowns across the ticket UI need
// it); creating and deactivating agents is admin-only.
@UseGuards(TenantHeaderGuard, RolesGuard)
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.agents.list(tenantId);
  }

  @Roles('admin')
  @Post()
  create(@CurrentTenantId() tenantId: string, @Body() dto: CreateAgentDto) {
    return this.agents.create(tenantId, dto);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgentDto,
  ) {
    return this.agents.update(tenantId, id, dto);
  }
}
