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
import { CreateAgentTokenDto, UpdateAgentTokenDto } from './agent-tokens.dto';
import { AgentTokensService } from './agent-tokens.service';

@UseGuards(TenantHeaderGuard)
@Controller('agent-tokens')
export class AgentTokensController {
  constructor(private readonly agentTokens: AgentTokensService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string) {
    return this.agentTokens.list(tenantId);
  }

  @Post()
  create(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateAgentTokenDto,
  ) {
    return this.agentTokens.create(tenantId, dto);
  }

  @Patch(':id')
  update(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAgentTokenDto,
  ) {
    return this.agentTokens.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.agentTokens.remove(tenantId, id);
  }
}
