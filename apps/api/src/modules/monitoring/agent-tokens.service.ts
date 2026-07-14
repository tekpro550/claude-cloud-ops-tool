import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { signDeviceJwt } from '../platform/auth/jwt';
import { CreateAgentTokenDto, UpdateAgentTokenDto } from './agent-tokens.dto';

@Injectable()
export class AgentTokensService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT id, resource_id, label, is_enabled, last_seen_at, created_at FROM agent_tokens ORDER BY created_at`,
      ),
    );
  }

  /** The signed device token is only ever returned here, at creation -- there is nothing to re-display later since it isn't stored raw. */
  create(tenantId: string, dto: CreateAgentTokenDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [resource] = await queryRunner.query(
        `SELECT id FROM resources WHERE id = $1`,
        [dto.resourceId],
      );
      if (!resource) {
        throw new NotFoundException(`Resource ${dto.resourceId} not found`);
      }

      const [row] = await queryRunner.query(
        `INSERT INTO agent_tokens (tenant_id, resource_id, label) VALUES ($1, $2, $3) RETURNING *`,
        [tenantId, dto.resourceId, dto.label],
      );
      const token = signDeviceJwt({
        sub: row.id,
        tenantId,
        resourceId: dto.resourceId,
        kind: 'device',
      });
      return { ...row, token };
    });
  }

  async update(tenantId: string, id: string, dto: UpdateAgentTokenDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM agent_tokens WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Agent token ${id} not found`);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.label !== undefined) assign('label', dto.label);
      if (dto.isEnabled !== undefined) assign('is_enabled', dto.isEnabled);

      if (sets.length === 0) {
        const [row] = await queryRunner.query(
          `SELECT id, resource_id, label, is_enabled, last_seen_at, created_at FROM agent_tokens WHERE id = $1`,
          [id],
        );
        return row;
      }

      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE agent_tokens SET ${sets.join(', ')} WHERE id = $${params.length}
         RETURNING id, resource_id, label, is_enabled, last_seen_at, created_at`,
        params,
      );
      return rows[0];
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM agent_tokens WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Agent token ${id} not found`);
      }
    });
  }
}
