import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { CreateAgentDto, UpdateAgentDto } from './agents.dto';

async function assertGroupsBelongToTenant(queryRunner: QueryRunner, groupIds: string[]): Promise<void> {
  for (const groupId of groupIds) {
    const rows = await queryRunner.query(`SELECT 1 FROM groups WHERE id = $1`, [groupId]);
    if (rows.length === 0) {
      throw new BadRequestException(`Group ${groupId} not found for this tenant`);
    }
  }
}

@Injectable()
export class AgentsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT a.id, a.group_ids, a.is_active, u.name, u.email
         FROM agents a JOIN users u ON u.id = a.user_id
         ORDER BY u.name`,
      ),
    );
  }

  async create(tenantId: string, dto: CreateAgentDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      if (dto.groupIds?.length) {
        await assertGroupsBelongToTenant(queryRunner, dto.groupIds);
      }

      let user;
      try {
        // No auth system exists yet (see the Sprint 1.1 seed migration for
        // the same convention) -- 'x' is a placeholder password_hash, not a
        // real credential. Creating an agent here doesn't grant login access
        // to anything.
        [user] = await queryRunner.query(
          `INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES ($1, $2, $3, 'x', 'agent') RETURNING id`,
          [tenantId, dto.email, dto.name],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new BadRequestException(`A user with email ${dto.email} already exists for this tenant`);
        }
        throw err;
      }

      const [agent] = await queryRunner.query(
        `INSERT INTO agents (tenant_id, user_id, group_ids) VALUES ($1, $2, $3) RETURNING id, group_ids, is_active`,
        [tenantId, user.id, dto.groupIds ?? []],
      );
      return { ...agent, name: dto.name, email: dto.email };
    });
  }

  async update(tenantId: string, id: string, dto: UpdateAgentDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(`SELECT id FROM agents WHERE id = $1`, [id]);
      if (!existing) {
        throw new NotFoundException(`Agent ${id} not found`);
      }
      if (dto.groupIds?.length) {
        await assertGroupsBelongToTenant(queryRunner, dto.groupIds);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.isActive !== undefined) assign('is_active', dto.isActive);
      if (dto.groupIds !== undefined) assign('group_ids', dto.groupIds);

      if (sets.length === 0) {
        const [row] = await queryRunner.query(
          `SELECT a.id, a.group_ids, a.is_active, u.name, u.email FROM agents a JOIN users u ON u.id = a.user_id WHERE a.id = $1`,
          [id],
        );
        return row;
      }

      params.push(id);
      await queryRunner.query(`UPDATE agents SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
      const [row] = await queryRunner.query(
        `SELECT a.id, a.group_ids, a.is_active, u.name, u.email FROM agents a JOIN users u ON u.id = a.user_id WHERE a.id = $1`,
        [id],
      );
      return row;
    });
  }
}
