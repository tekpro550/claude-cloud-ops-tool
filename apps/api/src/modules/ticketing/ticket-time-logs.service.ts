import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { assertTicketExists } from './assert-ticket-exists';
import { CreateTicketTimeLogDto } from './ticket-time-logs.dto';

async function assertBelongsToTenant(
  queryRunner: QueryRunner,
  table: string,
  id: string,
  label: string,
): Promise<void> {
  const rows = await queryRunner.query(`SELECT 1 FROM ${table} WHERE id = $1`, [
    id,
  ]);
  if (rows.length === 0) {
    throw new BadRequestException(`${label} ${id} not found for this tenant`);
  }
}

@Injectable()
export class TicketTimeLogsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  create(tenantId: string, ticketId: string, dto: CreateTicketTimeLogDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      await assertTicketExists(queryRunner, ticketId);
      if (dto.agentId) {
        await assertBelongsToTenant(
          queryRunner,
          'agents',
          dto.agentId,
          'agent',
        );
      }
      const [log] = await queryRunner.query(
        `INSERT INTO ticket_time_logs (tenant_id, ticket_id, agent_id, minutes, note, logged_at)
         VALUES ($1, $2, $3, $4, $5, now())
         RETURNING *`,
        [
          tenantId,
          ticketId,
          dto.agentId ?? null,
          dto.minutes,
          dto.note ?? null,
        ],
      );
      return log;
    });
  }

  list(tenantId: string, ticketId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      await assertTicketExists(queryRunner, ticketId);
      const items = await queryRunner.query(
        `SELECT * FROM ticket_time_logs WHERE ticket_id = $1 ORDER BY logged_at ASC`,
        [ticketId],
      );
      const [{ total }] = await queryRunner.query(
        `SELECT coalesce(sum(minutes), 0)::int AS total FROM ticket_time_logs WHERE ticket_id = $1`,
        [ticketId],
      );
      return { items, totalMinutes: total };
    });
  }

  async remove(
    tenantId: string,
    ticketId: string,
    logId: string,
  ): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM ticket_time_logs WHERE id = $1 AND ticket_id = $2 RETURNING id`,
        [logId, ticketId],
      );
      if (rows.length === 0) {
        throw new NotFoundException(
          `Time log ${logId} not found on ticket ${ticketId}`,
        );
      }
    });
  }
}
