import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';

export interface AllocationRow {
  tagValue: string;
  amount: number;
}

/**
 * Tag-based cost allocation (CloudSpend "showback/chargeback" gap): break a
 * tenant's spend down by the value of a chosen cost-allocation tag key
 * (team, environment, project, ...). Reads the tags jsonb column added to
 * cost_line_items and groups on the requested key, folding line items that
 * lack the key into an explicit "untagged" bucket so the total always
 * reconciles with the dashboard's MTD spend.
 */
@Injectable()
export class CostAllocationService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Distinct tag keys in use across the tenant's line items, sorted, for the picker. */
  async tagKeys(tenantId: string): Promise<string[]> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const rows = await queryRunner.query(
        `SELECT DISTINCT jsonb_object_keys(tags) AS key
         FROM cost_line_items
         WHERE tags <> '{}'::jsonb
         ORDER BY key ASC`,
      );
      return rows.map((r: { key: string }) => r.key);
    });
  }

  /**
   * Spend grouped by the value of `tagKey`, highest first, over an optional
   * usage-date window (defaults to the current month to date). Line items
   * without the key are returned under the value '(untagged)'.
   */
  async allocationByTag(
    tenantId: string,
    tagKey: string,
    opts: { from?: string; to?: string } = {},
  ): Promise<{ tagKey: string; total: number; rows: AllocationRow[] }> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const params: unknown[] = [tagKey];
      const conditions: string[] = [];
      if (opts.from) {
        params.push(opts.from);
        conditions.push(`usage_date >= $${params.length}`);
      } else {
        conditions.push(`usage_date >= date_trunc('month', now())::date`);
      }
      if (opts.to) {
        params.push(opts.to);
        conditions.push(`usage_date <= $${params.length}`);
      }
      const where = `WHERE ${conditions.join(' AND ')}`;

      const rows = await queryRunner.query(
        `SELECT COALESCE(NULLIF(tags->>$1, ''), '(untagged)') AS tag_value,
                SUM(amount)::float AS amount
         FROM cost_line_items
         ${where}
         GROUP BY 1
         ORDER BY amount DESC`,
        params,
      );

      const allocationRows: AllocationRow[] = rows.map(
        (r: { tag_value: string; amount: number }) => ({
          tagValue: r.tag_value,
          amount: r.amount,
        }),
      );
      const total = allocationRows.reduce((sum, r) => sum + r.amount, 0);
      return { tagKey, total, rows: allocationRows };
    });
  }
}
