import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { CurrentUserId } from '../../platform/http/current-user.decorator';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { AddChatMessageDto, CreateChatSessionDto } from './chat.dto';
import { ChatService } from './chat.service';

/**
 * Agent-facing chat console. Sessions are opened by visitors (portal/widget can
 * post through the same service later); agents list them, reply, and close them.
 * Delivery is delta polling via `?since=` on the messages endpoint.
 */
@UseGuards(TenantHeaderGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('sessions')
  createSession(
    @CurrentTenantId() tenantId: string,
    @Body() dto: CreateChatSessionDto,
  ) {
    return this.chat.createSession(tenantId, dto);
  }

  @Get('sessions')
  listSessions(
    @CurrentTenantId() tenantId: string,
    @Query('status') status?: string,
  ) {
    return this.chat.listSessions(tenantId, status);
  }

  @Get('sessions/:id')
  getSession(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chat.getSession(tenantId, id);
  }

  @Post('sessions/:id/messages')
  addMessage(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddChatMessageDto,
  ) {
    // An agent reply defaults to the authenticated agent when the client omits it.
    const authorId =
      dto.authorType === 'agent' ? (dto.authorId ?? userId) : dto.authorId;
    return this.chat.addMessage(tenantId, id, { ...dto, authorId });
  }

  @Get('sessions/:id/messages')
  listMessages(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('since') since?: string,
  ) {
    return this.chat.listMessages(tenantId, id, since);
  }

  @Patch('sessions/:id/close')
  closeSession(
    @CurrentTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chat.closeSession(tenantId, id);
  }
}
