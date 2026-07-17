import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { CreateResourceDto, UpdateResourceDto } from './resources.dto';

/**
 * Module 1 defined `resources` (Foundation schema) but never built CRUD for
 * it -- nothing needed to create one directly until Module 2, where it's the
 * join point for monitors, agent_tokens, and downtime_events. Cloud-account
 * resources are still created only by CloudResourcePollerService's
 * discovery upsert (see cloud-resource-poller.service.ts); this is for
 * everything a tenant wants monitored that isn't auto-discovered.
 */
@Injectable()
export class ResourcesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`SELECT * FROM resources ORDER BY name`),
    );
  }

  async get(tenantId: string, id: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [resource] = await queryRunner.query(
        `SELECT * FROM resources WHERE id = $1`,
        [id],
      );
      if (!resource) {
        throw new NotFoundException(`Resource ${id} not found`);
      }
      return resource;
    });
  }

  create(tenantId: string, dto: CreateResourceDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [resource] = await queryRunner.query(
        `INSERT INTO resources (tenant_id, name, resource_type, group_name, tags)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          tenantId,
          dto.name,
          dto.resourceType,
          dto.groupName ?? null,
          JSON.stringify(dto.tags ?? {}),
        ],
      );
      return resource;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateResourceDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM resources WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Resource ${id} not found`);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.name !== undefined) assign('name', dto.name);
      if (dto.groupName !== undefined) assign('group_name', dto.groupName);
      if (dto.tags !== undefined) assign('tags', JSON.stringify(dto.tags));

      if (sets.length === 0) {
        const [resource] = await queryRunner.query(
          `SELECT * FROM resources WHERE id = $1`,
          [id],
        );
        return resource;
      }

      sets.push(`updated_at = now()`);
      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE resources SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  /**
   * One row per resource with its monitors' worst current status rolled up
   * -- the fleet-wide landing view (section 6 of the scope doc). "Worst"
   * ranks down > critical > trouble > up, with null meaning "no monitors
   * configured yet" rather than healthy.
   */
  fleetSummary(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`
        SELECT
          r.id, r.name, r.resource_type, r.group_name,
          count(m.id)::int AS monitor_count,
          (
            SELECT lc.status FROM monitors m2
            LEFT JOIN LATERAL (
              SELECT status FROM monitor_checks mc WHERE mc.monitor_id = m2.id ORDER BY mc.checked_at DESC LIMIT 1
            ) lc ON true
            WHERE m2.resource_id = r.id AND m2.is_enabled = true AND lc.status IS NOT NULL
            ORDER BY CASE lc.status
              WHEN 'down' THEN 0 WHEN 'critical' THEN 1 WHEN 'trouble' THEN 2 WHEN 'up' THEN 3 ELSE 4 END
            LIMIT 1
          ) AS worst_status
        FROM resources r
        LEFT JOIN monitors m ON m.resource_id = r.id
        GROUP BY r.id
        ORDER BY r.name
      `),
    );
  }

  /** Per-resource template (section 6): the resource plus every monitor on it with its latest check. */
  async dashboard(tenantId: string, id: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [resource] = await queryRunner.query(
        `SELECT * FROM resources WHERE id = $1`,
        [id],
      );
      if (!resource) {
        throw new NotFoundException(`Resource ${id} not found`);
      }

      const monitors = await queryRunner.query(
        `SELECT m.*, lc.status AS last_status, lc.checked_at AS last_checked_at, lc.raw_output AS last_raw_output
         FROM monitors m
         LEFT JOIN LATERAL (
           SELECT status, checked_at, raw_output FROM monitor_checks mc
           WHERE mc.monitor_id = m.id ORDER BY mc.checked_at DESC LIMIT 1
         ) lc ON true
         WHERE m.resource_id = $1
         ORDER BY m.name`,
        [id],
      );

      const activeAlerts = await queryRunner.query(
        `SELECT a.* FROM alerts a JOIN monitors m ON m.id = a.monitor_id
         WHERE m.resource_id = $1 AND a.status IN ('open', 'acknowledged')
         ORDER BY a.opened_at DESC`,
        [id],
      );

      const openDowntime = await queryRunner.query(
        `SELECT * FROM downtime_events WHERE resource_id = $1 AND ends_at IS NULL ORDER BY starts_at DESC`,
        [id],
      );

      return { resource, monitors, activeAlerts, openDowntime };
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM resources WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Resource ${id} not found`);
      }
    });
  }
}
