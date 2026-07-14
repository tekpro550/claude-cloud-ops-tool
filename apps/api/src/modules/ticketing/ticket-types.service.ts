import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { CreateTicketTypeDto, UpdateTicketTypeDto } from './ticket-types.dto';

async function assertBelongsToTenant(
  queryRunner: QueryRunner,
  table: string,
  id: string,
  label: string,
): Promise<void> {
  const rows = await queryRunner.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
  if (rows.length === 0) {
    throw new BadRequestException(`${label} ${id} not found for this tenant`);
  }
}

@Injectable()
export class TicketTypesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`SELECT * FROM ticket_types ORDER BY name`),
    );
  }

  create(tenantId: string, dto: CreateTicketTypeDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      if (dto.defaultGroupId) {
        await assertBelongsToTenant(queryRunner, 'groups', dto.defaultGroupId, 'group');
      }
      if (dto.defaultSlaPolicyId) {
        await assertBelongsToTenant(queryRunner, 'sla_policies', dto.defaultSlaPolicyId, 'SLA policy');
      }
      const [ticketType] = await queryRunner.query(
        `INSERT INTO ticket_types (tenant_id, name, default_group_id, default_sla_policy_id) VALUES ($1, $2, $3, $4) RETURNING *`,
        [tenantId, dto.name, dto.defaultGroupId ?? null, dto.defaultSlaPolicyId ?? null],
      );
      return ticketType;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateTicketTypeDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(`SELECT id FROM ticket_types WHERE id = $1`, [id]);
      if (!existing) {
        throw new NotFoundException(`Ticket type ${id} not found`);
      }
      if (dto.defaultGroupId) {
        await assertBelongsToTenant(queryRunner, 'groups', dto.defaultGroupId, 'group');
      }
      if (dto.defaultSlaPolicyId) {
        await assertBelongsToTenant(queryRunner, 'sla_policies', dto.defaultSlaPolicyId, 'SLA policy');
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.name !== undefined) assign('name', dto.name);
      if (dto.defaultGroupId !== undefined) assign('default_group_id', dto.defaultGroupId);
      if (dto.defaultSlaPolicyId !== undefined) assign('default_sla_policy_id', dto.defaultSlaPolicyId);

      if (sets.length === 0) {
        const [ticketType] = await queryRunner.query(`SELECT * FROM ticket_types WHERE id = $1`, [id]);
        return ticketType;
      }

      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE ticket_types SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      try {
        const [rows] = await queryRunner.query(`DELETE FROM ticket_types WHERE id = $1 RETURNING id`, [id]);
        if (rows.length === 0) {
          throw new NotFoundException(`Ticket type ${id} not found`);
        }
      } catch (err) {
        if ((err as { code?: string }).code === '23503') {
          throw new BadRequestException(
            `Ticket type ${id} is still referenced by existing tickets and cannot be deleted`,
          );
        }
        throw err;
      }
    });
  }
}
