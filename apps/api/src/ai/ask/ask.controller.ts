import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../../modules/platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../../modules/platform/http/tenant-header.guard';
import { AskService } from './ask.service';

class CreateSessionDto {}

class AskMessageDto {
  message: string;
}

@UseGuards(TenantHeaderGuard)
@Controller('ask')
export class AskController {
  constructor(private readonly ask: AskService) {}

  /** Create a new conversation session. */
  @Post('sessions')
  @HttpCode(201)
  createSession(@CurrentTenantId() tenantId: string) {
    return this.ask.createSession(tenantId);
  }

  /** Post a message and get the AI's response. */
  @Post('sessions/:id/messages')
  askMessage(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) sessionId: string,
    @Body() dto: AskMessageDto,
  ) {
    return this.ask.ask(tenantId, sessionId, dto.message);
  }

  /** Retrieve all messages in a session (conversation history). */
  @Get('sessions/:id/messages')
  getMessages(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) sessionId: string,
  ) {
    return this.ask.getMessages(tenantId, sessionId);
  }
}
