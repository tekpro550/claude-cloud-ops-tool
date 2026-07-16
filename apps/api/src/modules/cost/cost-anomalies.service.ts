import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';

@Injectable()
export class CostAnomaliesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT id, cloud_credential_id, service, region, usage_date,
                baseline_amount, actual_amount, deviation_pct, reason_text, status, created_at
         FROM cost_anomalies WHERE status = 'open'
         ORDER BY usage_date DESC, actual_amount DESC`,
      ),
    );
  }

  async dismiss(tenantId: string, id: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `UPDATE cost_anomalies SET status = 'dismissed' WHERE id = $1 RETURNING id`,
        [id],
      );
      if (!rows || rows.length === 0) {
        throw new NotFoundException(`Cost anomaly ${id} not found`);
      }
    });
  }
}
