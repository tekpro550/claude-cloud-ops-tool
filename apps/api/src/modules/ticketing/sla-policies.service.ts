import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { CreateSlaPolicyDto, UpdateSlaPolicyDto } from './sla-policies.dto';

@Injectable()
export class SlaPoliciesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`SELECT * FROM sla_policies ORDER BY name`),
    );
  }

  create(tenantId: string, dto: CreateSlaPolicyDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [policy] = await queryRunner.query(
        `INSERT INTO sla_policies (tenant_id, name, first_response_target_minutes, resolution_target_minutes, business_hours_only)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          tenantId,
          dto.name,
          dto.firstResponseTargetMinutes,
          dto.resolutionTargetMinutes,
          dto.businessHoursOnly ?? false,
        ],
      );
      return policy;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateSlaPolicyDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM sla_policies WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`SLA policy ${id} not found`);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.name !== undefined) assign('name', dto.name);
      if (dto.firstResponseTargetMinutes !== undefined)
        assign('first_response_target_minutes', dto.firstResponseTargetMinutes);
      if (dto.resolutionTargetMinutes !== undefined)
        assign('resolution_target_minutes', dto.resolutionTargetMinutes);
      if (dto.businessHoursOnly !== undefined)
        assign('business_hours_only', dto.businessHoursOnly);

      if (sets.length === 0) {
        const [policy] = await queryRunner.query(
          `SELECT * FROM sla_policies WHERE id = $1`,
          [id],
        );
        return policy;
      }

      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE sla_policies SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      try {
        const [rows] = await queryRunner.query(
          `DELETE FROM sla_policies WHERE id = $1 RETURNING id`,
          [id],
        );
        if (rows.length === 0) {
          throw new NotFoundException(`SLA policy ${id} not found`);
        }
      } catch (err) {
        // Both ticket_types.default_sla_policy_id and tickets.sla_policy_id
        // are ON DELETE SET NULL (see the Sprint 2.1 migration), so a
        // policy in active use can still be deleted -- this catch is just
        // defensive in case that ever changes.
        if ((err as { code?: string }).code === '23503') {
          throw new BadRequestException(
            `SLA policy ${id} is still referenced and cannot be deleted`,
          );
        }
        throw err;
      }
    });
  }
}
