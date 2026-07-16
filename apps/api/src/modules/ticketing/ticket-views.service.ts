import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { CreateTicketViewDto, UpdateTicketViewDto } from './ticket-views.dto';

/**
 * Saved/custom ticket views (Freshdesk Growth-plan gap): an agent-defined
 * filter combination saved under a name, as opposed to the four hardcoded
 * quick-view tabs the ticket list already had. agentId null means a
 * shared/team view (created by an anonymous/header-only request, or
 * explicitly meant for everyone); listing returns shared views plus the
 * caller's own, the same "mine + team's" split Freshdesk's saved views use.
 */
@Injectable()
export class TicketViewsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  create(
    tenantId: string,
    agentId: string | undefined,
    dto: CreateTicketViewDto,
  ) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [view] = await queryRunner.query(
        `INSERT INTO ticket_views (tenant_id, agent_id, name, filters) VALUES ($1, $2, $3, $4) RETURNING *`,
        [tenantId, agentId ?? null, dto.name, JSON.stringify(dto.filters)],
      );
      return view;
    });
  }

  list(tenantId: string, agentId: string | undefined) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT * FROM ticket_views WHERE agent_id IS NULL OR agent_id = $1 ORDER BY created_at`,
        [agentId ?? null],
      ),
    );
  }

  async update(tenantId: string, id: string, dto: UpdateTicketViewDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM ticket_views WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Ticket view ${id} not found`);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.name !== undefined) assign('name', dto.name);
      if (dto.filters !== undefined)
        assign('filters', JSON.stringify(dto.filters));

      if (sets.length === 0) {
        const [view] = await queryRunner.query(
          `SELECT * FROM ticket_views WHERE id = $1`,
          [id],
        );
        return view;
      }

      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE ticket_views SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM ticket_views WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Ticket view ${id} not found`);
      }
    });
  }
}
