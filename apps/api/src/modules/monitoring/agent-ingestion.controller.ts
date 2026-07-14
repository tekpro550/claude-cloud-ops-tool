import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AgentReportDto } from './agent-report.dto';
import { AgentIngestionService } from './agent-ingestion.service';
import { AgentScopedRequest, AgentTokenGuard } from './agent-token.guard';

@UseGuards(AgentTokenGuard)
@Controller('agent')
export class AgentIngestionController {
  constructor(private readonly agentIngestion: AgentIngestionService) {}

  @Post('heartbeat')
  @HttpCode(204)
  heartbeat(@Req() req: AgentScopedRequest) {
    return this.agentIngestion.heartbeat(req.tenantId, req.agentTokenId);
  }

  @Post('report')
  @HttpCode(204)
  report(@Req() req: AgentScopedRequest, @Body() dto: AgentReportDto) {
    return this.agentIngestion.report(
      req.tenantId,
      req.agentTokenId,
      req.resourceId,
      dto,
    );
  }
}
