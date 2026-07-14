import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { CreateAgentDto, UpdateAgentDto } from './agents.dto';

async function assertGroupsBelongToTenant(
  queryRunner: QueryRunner,
  groupIds: string[],
): Promise<void> {
  for (const groupId of groupIds) {
    const rows = await queryRunner.query(`SELECT 1 FROM groups WHERE id = $1`, [
      groupId,
    ]);
    if (rows.length === 0) {
      throw new BadRequestException(
        `Group ${groupId} not found for this tenant`,
      );
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

  /**
   * Resolves the logged-in user's own agent row (used to attribute a message
   * or property change to the actual agent instead of a generic "system"
   * author now that real login exists). Returns null rather than throwing --
   * a user with no linked agent row (shouldn't normally happen for seeded
   * agents, but isn't fatal) just falls back to the caller's own default.
   */
  async findByUserId(
    tenantId: string,
    userId: string,
  ): Promise<{ id: string } | null> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [agent] = await queryRunner.query(
        `SELECT id FROM agents WHERE user_id = $1`,
        [userId],
      );
      return agent ?? null;
    });
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
          throw new BadRequestException(
            `A user with email ${dto.email} already exists for this tenant`,
          );
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
      const [existing] = await queryRunner.query(
        `SELECT user_id FROM agents WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Agent ${id} not found`);
      }
      if (dto.groupIds?.length) {
        await assertGroupsBelongToTenant(queryRunner, dto.groupIds);
      }

      // name/email live on the linked users row, not on agents itself, so
      // they're updated separately from the agents SET below.
      if (dto.name !== undefined || dto.email !== undefined) {
        const userSets: string[] = [];
        const userParams: unknown[] = [];
        const assignUser = (column: string, value: unknown) => {
          userParams.push(value);
          userSets.push(`${column} = $${userParams.length}`);
        };
        if (dto.name !== undefined) assignUser('name', dto.name);
        if (dto.email !== undefined) assignUser('email', dto.email);
        userParams.push(existing.user_id);
        try {
          await queryRunner.query(
            `UPDATE users SET ${userSets.join(', ')} WHERE id = $${userParams.length}`,
            userParams,
          );
        } catch (err) {
          if ((err as { code?: string }).code === '23505') {
            throw new BadRequestException(
              `A user with email ${dto.email} already exists for this tenant`,
            );
          }
          throw err;
        }
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.isActive !== undefined) assign('is_active', dto.isActive);
      if (dto.groupIds !== undefined) assign('group_ids', dto.groupIds);

      if (sets.length > 0) {
        params.push(id);
        await queryRunner.query(
          `UPDATE agents SET ${sets.join(', ')} WHERE id = $${params.length}`,
          params,
        );
      }

      const [row] = await queryRunner.query(
        `SELECT a.id, a.group_ids, a.is_active, u.name, u.email FROM agents a JOIN users u ON u.id = a.user_id WHERE a.id = $1`,
        [id],
      );
      return row;
    });
  }
}
