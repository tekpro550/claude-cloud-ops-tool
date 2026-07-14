import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { CreateDowntimeEventDto } from './downtime-events.dto';

@Injectable()
export class DowntimeEventsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT * FROM downtime_events ORDER BY starts_at DESC`,
      ),
    );
  }

  create(tenantId: string, dto: CreateDowntimeEventDto, createdBy?: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [resource] = await queryRunner.query(
        `SELECT id FROM resources WHERE id = $1`,
        [dto.resourceId],
      );
      if (!resource) {
        throw new NotFoundException(`Resource ${dto.resourceId} not found`);
      }

      const [event] = await queryRunner.query(
        `INSERT INTO downtime_events (tenant_id, resource_id, monitor_id, reason, is_manual, created_by)
         VALUES ($1, $2, $3, $4, true, $5)
         RETURNING *`,
        [
          tenantId,
          dto.resourceId,
          dto.monitorId ?? null,
          dto.reason,
          createdBy ?? null,
        ],
      );
      return event;
    });
  }

  async end(tenantId: string, id: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id, ends_at FROM downtime_events WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Downtime event ${id} not found`);
      }
      if (existing.ends_at) {
        throw new BadRequestException(`Downtime event ${id} has already ended`);
      }

      const [rows] = await queryRunner.query(
        `UPDATE downtime_events SET ends_at = now() WHERE id = $1 RETURNING *`,
        [id],
      );
      return rows[0];
    });
  }
}
