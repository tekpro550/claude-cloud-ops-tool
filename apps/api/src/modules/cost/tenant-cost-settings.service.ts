import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UpdateTenantCostSettingsDto } from './tenant-cost-settings.dto';

const COLUMNS = 'id, financial_year_start_month, cost_rate_display';

/**
 * financial_year_start_month/cost_rate_display are plain columns on
 * `tenants` (architecture plan section 8), not their own entity -- read
 * straight off the tenants row rather than through withTenantContext, which
 * exists to set the RLS session variable other tables filter by; `tenants`
 * itself has no such policy; it's what current_tenant means, not something
 * scoped by it.
 */
@Injectable()
export class TenantCostSettingsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async get(tenantId: string) {
    const [row] = await this.dataSource.query(
      `SELECT ${COLUMNS} FROM tenants WHERE id = $1`,
      [tenantId],
    );
    if (!row) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }
    return row;
  }

  async update(tenantId: string, dto: UpdateTenantCostSettingsDto) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const assign = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (dto.financialYearStartMonth !== undefined) {
      assign('financial_year_start_month', dto.financialYearStartMonth);
    }
    if (dto.costRateDisplay !== undefined) {
      assign('cost_rate_display', dto.costRateDisplay);
    }

    if (sets.length === 0) {
      return this.get(tenantId);
    }

    params.push(tenantId);
    const [rows] = await this.dataSource.query(
      `UPDATE tenants SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
      params,
    );
    if (!rows || rows.length === 0) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }
    return rows[0];
  }
}
