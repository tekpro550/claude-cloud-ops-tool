import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IngestLogBatchDto } from './logs.dto';
import { LogIngestionService } from './log-ingestion.service';
import {
  LogSourceScopedRequest,
  LogSourceTokenGuard,
} from './log-source-token.guard';

@UseGuards(LogSourceTokenGuard)
@Controller('logs')
export class LogIngestionController {
  constructor(private readonly ingestion: LogIngestionService) {}

  @Post('ingest')
  @HttpCode(204)
  ingest(@Req() req: LogSourceScopedRequest, @Body() dto: IngestLogBatchDto) {
    return this.ingestion.ingest(req.tenantId, req.logSourceId, dto.entries);
  }
}
