import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { CreateAlertRuleDto, UpdateAlertRuleDto } from './alert-rules.dto';

const DUPLICATE_KEY_ERROR = '23505';

@Injectable()
export class AlertRulesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`SELECT * FROM alert_rules ORDER BY created_at`),
    );
  }

  create(tenantId: string, dto: CreateAlertRuleDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [monitor] = await queryRunner.query(
        `SELECT id FROM monitors WHERE id = $1`,
        [dto.monitorId],
      );
      if (!monitor) {
        throw new NotFoundException(`Monitor ${dto.monitorId} not found`);
      }

      try {
        const [rule] = await queryRunner.query(
          `INSERT INTO alert_rules (tenant_id, monitor_id, condition, severity, is_enabled, escalation_policy_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            tenantId,
            dto.monitorId,
            JSON.stringify(dto.condition ?? { statusIn: ['down', 'critical'] }),
            dto.severity ?? 'critical',
            dto.isEnabled ?? true,
            dto.escalationPolicyId ?? null,
          ],
        );
        return rule;
      } catch (err) {
        if ((err as { code?: string }).code === DUPLICATE_KEY_ERROR) {
          throw new BadRequestException(
            `Monitor ${dto.monitorId} already has an alert rule`,
          );
        }
        throw err;
      }
    });
  }

  async update(tenantId: string, id: string, dto: UpdateAlertRuleDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM alert_rules WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Alert rule ${id} not found`);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.condition !== undefined)
        assign('condition', JSON.stringify(dto.condition));
      if (dto.severity !== undefined) assign('severity', dto.severity);
      if (dto.isEnabled !== undefined) assign('is_enabled', dto.isEnabled);
      if (dto.escalationPolicyId !== undefined)
        assign('escalation_policy_id', dto.escalationPolicyId);

      if (sets.length === 0) {
        const [rule] = await queryRunner.query(
          `SELECT * FROM alert_rules WHERE id = $1`,
          [id],
        );
        return rule;
      }

      sets.push(`updated_at = now()`);
      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE alert_rules SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM alert_rules WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Alert rule ${id} not found`);
      }
    });
  }
}
