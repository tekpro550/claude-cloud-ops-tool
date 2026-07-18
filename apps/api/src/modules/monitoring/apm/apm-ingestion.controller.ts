import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { enforceIngestRate } from '../ingest-rate-limit';
import { IngestTraceBatchDto } from './apm.dto';
import {
  ApmScopedRequest,
  ApmIngestTokenGuard,
} from './apm-ingest-token.guard';
import { ApmService } from './apm.service';

@UseGuards(ApmIngestTokenGuard)
@Controller('apm')
export class ApmIngestionController {
  constructor(private readonly apm: ApmService) {}

  @Post('traces')
  @HttpCode(204)
  async ingest(@Req() req: ApmScopedRequest, @Body() dto: IngestTraceBatchDto) {
    await enforceIngestRate(`apm:${req.apmIngestKeyId}`);
    return this.apm.ingestTraces(req.tenantId, req.service, dto.traces);
  }
}
