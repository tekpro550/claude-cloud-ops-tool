import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import {
  CreateEscalationPolicyDto,
  UpdateEscalationPolicyDto,
} from './escalation-policies.dto';

@Injectable()
export class EscalationPoliciesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`SELECT * FROM escalation_policies ORDER BY name`),
    );
  }

  create(tenantId: string, dto: CreateEscalationPolicyDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [policy] = await queryRunner.query(
        `INSERT INTO escalation_policies (tenant_id, name, steps) VALUES ($1, $2, $3) RETURNING *`,
        [tenantId, dto.name, JSON.stringify(dto.steps)],
      );
      return policy;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateEscalationPolicyDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM escalation_policies WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Escalation policy ${id} not found`);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.name !== undefined) assign('name', dto.name);
      if (dto.steps !== undefined) assign('steps', JSON.stringify(dto.steps));

      if (sets.length === 0) {
        const [policy] = await queryRunner.query(
          `SELECT * FROM escalation_policies WHERE id = $1`,
          [id],
        );
        return policy;
      }

      sets.push(`updated_at = now()`);
      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE escalation_policies SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM escalation_policies WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Escalation policy ${id} not found`);
      }
    });
  }
}
