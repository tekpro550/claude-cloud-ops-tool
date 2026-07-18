import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { Roles } from '../../platform/http/roles.decorator';
import { RolesGuard } from '../../platform/http/roles.guard';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { AddAgentSkillDto } from './agent-skills.dto';
import { AgentSkillsService } from './agent-skills.service';

// Listing stays open (skill-based assignment previews / ticket UI need it);
// adding and removing skills is admin-only, same split as AgentsController.
@UseGuards(TenantHeaderGuard, RolesGuard)
@Controller('agent-skills')
export class AgentSkillsController {
  constructor(private readonly agentSkills: AgentSkillsService) {}

  @Get()
  list(
    @CurrentTenantId() tenantId: string,
    @Query('agentId') agentId?: string,
  ) {
    return this.agentSkills.list(tenantId, agentId);
  }

  @Roles('admin')
  @Post()
  add(@CurrentTenantId() tenantId: string, @Body() dto: AddAgentSkillDto) {
    return this.agentSkills.add(tenantId, dto);
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.agentSkills.remove(tenantId, id);
  }
}
