import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { ListSavingsLogQueryDto } from './savings-log.dto';

@Injectable()
export class SavingsLogService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string, filters: ListSavingsLogQueryDto) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (filters.resourceId) {
        params.push(filters.resourceId);
        conditions.push(`resource_id = $${params.length}`);
      }
      if (filters.ticketId) {
        params.push(filters.ticketId);
        conditions.push(`ticket_id = $${params.length}`);
      }
      if (filters.status) {
        params.push(filters.status);
        conditions.push(`status = $${params.length}`);
      }
      const where = conditions.length
        ? `WHERE ${conditions.join(' AND ')}`
        : '';
      return queryRunner.query(
        `SELECT * FROM cost_savings_log ${where} ORDER BY logged_at DESC`,
        params,
      );
    });
  }
}
