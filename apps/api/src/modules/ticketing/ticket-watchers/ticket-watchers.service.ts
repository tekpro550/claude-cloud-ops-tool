import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';

export interface Watcher {
  agentId: string;
  name: string;
  email: string;
}

/**
 * Ticket watchers. Watching is idempotent (unique index + ON CONFLICT). The
 * static watcherEmails() helper is shared with TicketsService so a new reply
 * can notify watchers inside the same tenant-scoped transaction.
 */
@Injectable()
export class TicketWatchersService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Watchers with their agent id + email, optionally excluding one agent (the author). */
  static async watcherEmails(
    queryRunner: QueryRunner,
    ticketId: string,
    excludeAgentId?: string | null,
  ): Promise<Watcher[]> {
    const rows = await queryRunner.query(
      `SELECT w.agent_id, u.name, u.email
       FROM ticket_watchers w
       JOIN agents a ON a.id = w.agent_id
       JOIN users u ON u.id = a.user_id
       WHERE w.ticket_id = $1 AND ($2::uuid IS NULL OR w.agent_id <> $2)`,
      [ticketId, excludeAgentId ?? null],
    );
    return rows.map((r: { agent_id: string; name: string; email: string }) => ({
      agentId: r.agent_id,
      name: r.name,
      email: r.email,
    }));
  }

  watch(tenantId: string, ticketId: string, agentId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      await queryRunner.query(
        `INSERT INTO ticket_watchers (tenant_id, ticket_id, agent_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (ticket_id, agent_id) DO NOTHING`,
        [tenantId, ticketId, agentId],
      );
      // Read back on the same queryRunner -- a nested withTenantContext would
      // be a separate transaction that can't see this uncommitted insert.
      return TicketWatchersService.watcherEmails(queryRunner, ticketId);
    });
  }

  unwatch(tenantId: string, ticketId: string, agentId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      await queryRunner.query(
        `DELETE FROM ticket_watchers WHERE ticket_id = $1 AND agent_id = $2`,
        [ticketId, agentId],
      );
      return TicketWatchersService.watcherEmails(queryRunner, ticketId);
    });
  }

  list(tenantId: string, ticketId: string): Promise<Watcher[]> {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      TicketWatchersService.watcherEmails(queryRunner, ticketId),
    );
  }
}
