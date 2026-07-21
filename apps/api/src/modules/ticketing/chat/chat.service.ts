import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { AddChatMessageDto, CreateChatSessionDto } from './chat.dto';
import { ChatAiResponderService } from './chat-ai-responder.service';

@Injectable()
export class ChatService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly aiResponder: ChatAiResponderService,
  ) {}

  createSession(tenantId: string, dto: CreateChatSessionDto) {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [session] = await qr.query(
        `INSERT INTO chat_sessions (tenant_id, visitor_name, contact_id)
         VALUES ($1, $2, $3) RETURNING *`,
        [tenantId, dto.visitorName, dto.contactId ?? null],
      );
      return session;
    });
  }

  /** Agent console: sessions, newest activity first, optionally filtered by status. */
  listSessions(tenantId: string, status?: string) {
    return withTenantContext(this.dataSource, tenantId, (qr) => {
      if (status === 'open' || status === 'closed') {
        return qr.query(
          `SELECT * FROM chat_sessions WHERE status = $1 ORDER BY last_message_at DESC`,
          [status],
        );
      }
      return qr.query(
        `SELECT * FROM chat_sessions ORDER BY last_message_at DESC`,
      );
    });
  }

  getSession(tenantId: string, id: string) {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [session] = await qr.query(
        `SELECT * FROM chat_sessions WHERE id = $1`,
        [id],
      );
      if (!session) throw new NotFoundException(`Chat session ${id} not found`);
      return session;
    });
  }

  async addMessage(
    tenantId: string,
    sessionId: string,
    dto: AddChatMessageDto,
  ) {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [session] = await qr.query(
        `SELECT id FROM chat_sessions WHERE id = $1`,
        [sessionId],
      );
      if (!session) {
        throw new NotFoundException(`Chat session ${sessionId} not found`);
      }
      const [message] = await qr.query(
        `INSERT INTO chat_messages (tenant_id, chat_session_id, author_type, author_id, body)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [tenantId, sessionId, dto.authorType, dto.authorId ?? null, dto.body],
      );
      // Bump activity; an agent replying also claims the session and reopens it.
      await qr.query(
        `UPDATE chat_sessions
           SET last_message_at = now(),
               assigned_agent_id = CASE WHEN $2 = 'agent' AND assigned_agent_id IS NULL THEN $3 ELSE assigned_agent_id END,
               status = CASE WHEN $2 = 'visitor' THEN 'open' ELSE status END
         WHERE id = $1`,
        [sessionId, dto.authorType, dto.authorId ?? null],
      );
      return message;
    }).then((message) => {
      // Fire-and-forget AI first-responder on a visitor turn. It self-gates on
      // the session being open, AI-enabled, and unclaimed, so this is a no-op
      // once a human agent is handling the chat.
      if (dto.authorType === 'visitor') {
        void this.aiResponder
          .respond(tenantId, sessionId)
          .catch(() => undefined);
      }
      return message;
    });
  }

  /** Messages in order; `since` (ISO) returns only newer ones so a poller fetches deltas. */
  listMessages(tenantId: string, sessionId: string, since?: string) {
    return withTenantContext(this.dataSource, tenantId, (qr) => {
      if (since) {
        return qr.query(
          `SELECT * FROM chat_messages
           WHERE chat_session_id = $1 AND created_at > $2
           ORDER BY created_at ASC`,
          [sessionId, since],
        );
      }
      return qr.query(
        `SELECT * FROM chat_messages WHERE chat_session_id = $1 ORDER BY created_at ASC`,
        [sessionId],
      );
    });
  }

  closeSession(tenantId: string, id: string) {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      // UPDATE ... RETURNING yields [rows, affectedCount] via TypeORM.
      const [rows] = await qr.query(
        `UPDATE chat_sessions SET status = 'closed' WHERE id = $1 RETURNING *`,
        [id],
      );
      if (!rows[0]) throw new NotFoundException(`Chat session ${id} not found`);
      return rows[0];
    });
  }
}
