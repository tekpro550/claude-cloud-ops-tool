import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { CreateMonitorDto, UpdateMonitorDto } from './monitors.dto';

@Injectable()
export class MonitorsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT m.*, lc.status AS last_status, lc.checked_at AS last_checked_at
         FROM monitors m
         LEFT JOIN LATERAL (
           SELECT status, checked_at FROM monitor_checks mc
           WHERE mc.monitor_id = m.id
           ORDER BY mc.checked_at DESC
           LIMIT 1
         ) lc ON true
         ORDER BY m.name`,
      ),
    );
  }

  async get(tenantId: string, id: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [monitor] = await queryRunner.query(
        `SELECT * FROM monitors WHERE id = $1`,
        [id],
      );
      if (!monitor) {
        throw new NotFoundException(`Monitor ${id} not found`);
      }
      return monitor;
    });
  }

  create(tenantId: string, dto: CreateMonitorDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [resource] = await queryRunner.query(
        `SELECT id FROM resources WHERE id = $1`,
        [dto.resourceId],
      );
      if (!resource) {
        throw new NotFoundException(`Resource ${dto.resourceId} not found`);
      }

      const [monitor] = await queryRunner.query(
        `INSERT INTO monitors (tenant_id, resource_id, name, monitor_type, config, interval_seconds, consecutive_failures_to_alert, min_failing_locations, is_enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          tenantId,
          dto.resourceId,
          dto.name,
          dto.monitorType,
          JSON.stringify(dto.config ?? {}),
          dto.intervalSeconds ?? 60,
          dto.consecutiveFailuresToAlert ?? 2,
          dto.minFailingLocations ?? 1,
          dto.isEnabled ?? true,
        ],
      );
      return monitor;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateMonitorDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM monitors WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Monitor ${id} not found`);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.name !== undefined) assign('name', dto.name);
      if (dto.config !== undefined)
        assign('config', JSON.stringify(dto.config));
      if (dto.intervalSeconds !== undefined)
        assign('interval_seconds', dto.intervalSeconds);
      if (dto.consecutiveFailuresToAlert !== undefined)
        assign('consecutive_failures_to_alert', dto.consecutiveFailuresToAlert);
      if (dto.isEnabled !== undefined) assign('is_enabled', dto.isEnabled);

      if (sets.length === 0) {
        const [monitor] = await queryRunner.query(
          `SELECT * FROM monitors WHERE id = $1`,
          [id],
        );
        return monitor;
      }

      sets.push(`updated_at = now()`);
      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE monitors SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  /**
   * Recent check history for one monitor, oldest first -- the data source
   * for a Site24x7-style uptime history bar (a strip of colored blocks, one
   * per check). Distinct from list()'s single "last check" join, which only
   * needs the latest status for a row, not the trailing history.
   */
  checks(tenantId: string, monitorId: string, limit: number) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [monitor] = await queryRunner.query(
        `SELECT id FROM monitors WHERE id = $1`,
        [monitorId],
      );
      if (!monitor) {
        throw new NotFoundException(`Monitor ${monitorId} not found`);
      }
      const rows = await queryRunner.query(
        `SELECT status, checked_at, response_time_ms FROM monitor_checks
         WHERE monitor_id = $1
         ORDER BY checked_at DESC
         LIMIT $2`,
        [monitorId, limit],
      );
      return rows.reverse();
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM monitors WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Monitor ${id} not found`);
      }
    });
  }
}
