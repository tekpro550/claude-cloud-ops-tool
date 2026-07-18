import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { signLogSourceJwt } from '../../platform/auth/jwt';
import {
  CreateLogAlertRuleDto,
  CreateLogSourceDto,
  UpdateLogAlertRuleDto,
  UpdateLogSourceDto,
} from './logs.dto';

export interface SearchLogsQuery {
  sourceId?: string;
  level?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
}

@Injectable()
export class LogsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // ---- Sources ----

  listSources(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`SELECT * FROM log_sources ORDER BY created_at DESC`),
    );
  }

  /** The signed ingest token is only ever returned here, at creation -- nothing is stored raw to re-display later. */
  createSource(tenantId: string, dto: CreateLogSourceDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [row] = await queryRunner.query(
        `INSERT INTO log_sources (tenant_id, name) VALUES ($1, $2) RETURNING *`,
        [tenantId, dto.name],
      );
      const token = signLogSourceJwt({
        sub: row.id,
        tenantId,
        kind: 'log_source',
      });
      return { ...row, token };
    });
  }

  async updateSource(tenantId: string, id: string, dto: UpdateLogSourceDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM log_sources WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Log source ${id} not found`);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.name !== undefined) assign('name', dto.name);
      if (dto.isActive !== undefined) assign('is_active', dto.isActive);

      if (sets.length === 0) {
        const [row] = await queryRunner.query(
          `SELECT * FROM log_sources WHERE id = $1`,
          [id],
        );
        return row;
      }

      sets.push(`updated_at = now()`);
      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE log_sources SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  async removeSource(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM log_sources WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Log source ${id} not found`);
      }
    });
  }

  // ---- Search ----

  search(tenantId: string, query: SearchLogsQuery) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      const push = (value: unknown) => {
        params.push(value);
        return `$${params.length}`;
      };

      if (query.sourceId) {
        conditions.push(`log_source_id = ${push(query.sourceId)}`);
      }
      if (query.level) {
        conditions.push(`level = ${push(query.level)}`);
      }
      if (query.from) {
        conditions.push(`ts >= ${push(query.from)}`);
      }
      if (query.to) {
        conditions.push(`ts <= ${push(query.to)}`);
      }
      if (query.q) {
        conditions.push(
          `to_tsvector('english', message) @@ plainto_tsquery('english', ${push(query.q)})`,
        );
      }

      const where = conditions.length
        ? `WHERE ${conditions.join(' AND ')}`
        : '';
      const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
      params.push(limit);

      return queryRunner.query(
        `SELECT * FROM log_entries ${where} ORDER BY ts DESC LIMIT $${params.length}`,
        params,
      );
    });
  }

  // ---- Alert rules ----

  listAlertRules(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT * FROM log_alert_rules ORDER BY created_at DESC`,
      ),
    );
  }

  createAlertRule(tenantId: string, dto: CreateLogAlertRuleDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [source] = await queryRunner.query(
        `SELECT id FROM log_sources WHERE id = $1`,
        [dto.logSourceId],
      );
      if (!source) {
        throw new NotFoundException(`Log source ${dto.logSourceId} not found`);
      }

      const [rule] = await queryRunner.query(
        `INSERT INTO log_alert_rules
           (tenant_id, log_source_id, name, match_query, level_at_least, window_seconds, threshold, escalation_policy_id, is_enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          tenantId,
          dto.logSourceId,
          dto.name,
          dto.matchQuery ?? null,
          dto.levelAtLeast ?? 'error',
          dto.windowSeconds ?? 300,
          dto.threshold ?? 1,
          dto.escalationPolicyId ?? null,
          dto.isEnabled ?? true,
        ],
      );
      return rule;
    });
  }

  async updateAlertRule(
    tenantId: string,
    id: string,
    dto: UpdateLogAlertRuleDto,
  ) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM log_alert_rules WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Log alert rule ${id} not found`);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.name !== undefined) assign('name', dto.name);
      if (dto.matchQuery !== undefined) assign('match_query', dto.matchQuery);
      if (dto.levelAtLeast !== undefined)
        assign('level_at_least', dto.levelAtLeast);
      if (dto.windowSeconds !== undefined)
        assign('window_seconds', dto.windowSeconds);
      if (dto.threshold !== undefined) assign('threshold', dto.threshold);
      if (dto.isEnabled !== undefined) assign('is_enabled', dto.isEnabled);

      if (sets.length === 0) {
        const [row] = await queryRunner.query(
          `SELECT * FROM log_alert_rules WHERE id = $1`,
          [id],
        );
        return row;
      }

      sets.push(`updated_at = now()`);
      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE log_alert_rules SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  async removeAlertRule(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM log_alert_rules WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Log alert rule ${id} not found`);
      }
    });
  }
}
