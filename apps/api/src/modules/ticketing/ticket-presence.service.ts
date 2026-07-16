import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';

// A presence row older than this is treated as gone rather than actively
// viewing -- the agent closed the tab or their heartbeat just hasn't
// happened yet; either way it shouldn't show as "currently viewing".
const PRESENCE_TTL_SECONDS = 20;

/**
 * Collision detection (Freshdesk Growth-plan gap): a lightweight
 * poll-based presence system rather than a websocket/live-push one, since
 * no realtime transport exists elsewhere in this app yet. The frontend
 * heartbeats every few seconds while a ticket is open and polls the same
 * interval for other agents' presence; anything older than
 * PRESENCE_TTL_SECONDS is filtered out server-side, so a stale tab just
 * ages out instead of needing an explicit "leaving" signal.
 */
@Injectable()
export class TicketPresenceService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  heartbeat(
    tenantId: string,
    ticketId: string,
    agentId: string,
    isTyping: boolean,
  ) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `INSERT INTO ticket_presence (tenant_id, ticket_id, agent_id, is_typing, last_seen_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (ticket_id, agent_id)
         DO UPDATE SET is_typing = $4, last_seen_at = now()`,
        [tenantId, ticketId, agentId, isTyping],
      ),
    );
  }

  list(tenantId: string, ticketId: string, excludeAgentId?: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT tp.agent_id, tp.is_typing, tp.last_seen_at, u.name AS agent_name
         FROM ticket_presence tp
         JOIN agents a ON a.id = tp.agent_id
         JOIN users u ON u.id = a.user_id
         WHERE tp.ticket_id = $1
           AND tp.last_seen_at > now() - ($2 || ' seconds')::interval
           AND ($3::uuid IS NULL OR tp.agent_id != $3)
         ORDER BY tp.last_seen_at DESC`,
        [ticketId, PRESENCE_TTL_SECONDS, excludeAgentId ?? null],
      ),
    );
  }
}
