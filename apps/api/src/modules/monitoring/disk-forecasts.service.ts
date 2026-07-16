import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';

@Injectable()
export class DiskForecastsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT df.id, df.monitor_id, df.resource_id, df.current_pct, df.rate_per_day,
                df.days_to_full, df.reason_text, df.status, df.updated_at, r.name AS resource_name
         FROM disk_forecasts df
         LEFT JOIN resources r ON r.id = df.resource_id
         WHERE df.status = 'open'
         ORDER BY df.days_to_full ASC`,
      ),
    );
  }

  async dismiss(tenantId: string, id: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `UPDATE disk_forecasts SET status = 'dismissed', updated_at = now() WHERE id = $1 RETURNING id`,
        [id],
      );
      if (!rows || rows.length === 0) {
        throw new NotFoundException(`Disk forecast ${id} not found`);
      }
    });
  }
}
