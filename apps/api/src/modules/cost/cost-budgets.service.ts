import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { CreateCostBudgetDto, UpdateCostBudgetDto } from './cost-budgets.dto';

@Injectable()
export class CostBudgetsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`SELECT * FROM cost_budgets ORDER BY name`),
    );
  }

  create(tenantId: string, dto: CreateCostBudgetDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [budget] = await queryRunner.query(
        `INSERT INTO cost_budgets (tenant_id, cloud_credential_id, name, monthly_budget_amount, pace_warning_threshold_pct, pace_critical_threshold_pct, notify_channel, notify_recipient)
         VALUES ($1, $2, $3, $4, COALESCE($5, 20), COALESCE($6, 40), $7, $8) RETURNING *`,
        [
          tenantId,
          dto.cloudCredentialId ?? null,
          dto.name,
          dto.monthlyBudgetAmount ?? null,
          dto.paceWarningThresholdPct ?? null,
          dto.paceCriticalThresholdPct ?? null,
          dto.notifyChannel ?? null,
          dto.notifyRecipient ?? null,
        ],
      );
      return budget;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateCostBudgetDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM cost_budgets WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Cost budget ${id} not found`);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.name !== undefined) assign('name', dto.name);
      if (dto.monthlyBudgetAmount !== undefined)
        assign('monthly_budget_amount', dto.monthlyBudgetAmount);
      if (dto.paceWarningThresholdPct !== undefined)
        assign('pace_warning_threshold_pct', dto.paceWarningThresholdPct);
      if (dto.paceCriticalThresholdPct !== undefined)
        assign('pace_critical_threshold_pct', dto.paceCriticalThresholdPct);
      if (dto.notifyChannel !== undefined)
        assign('notify_channel', dto.notifyChannel);
      if (dto.notifyRecipient !== undefined)
        assign('notify_recipient', dto.notifyRecipient);
      if (dto.isActive !== undefined) assign('is_active', dto.isActive);

      if (sets.length === 0) {
        const [budget] = await queryRunner.query(
          `SELECT * FROM cost_budgets WHERE id = $1`,
          [id],
        );
        return budget;
      }

      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE cost_budgets SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM cost_budgets WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Cost budget ${id} not found`);
      }
    });
  }
}
