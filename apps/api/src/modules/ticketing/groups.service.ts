import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { CreateGroupDto, UpdateGroupDto } from './groups.dto';

@Injectable()
export class GroupsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`SELECT * FROM groups ORDER BY name`),
    );
  }

  create(tenantId: string, dto: CreateGroupDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [group] = await queryRunner.query(
        `INSERT INTO groups (tenant_id, name, description) VALUES ($1, $2, $3) RETURNING *`,
        [tenantId, dto.name, dto.description ?? null],
      );
      return group;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateGroupDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM groups WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Group ${id} not found`);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.name !== undefined) assign('name', dto.name);
      if (dto.description !== undefined) assign('description', dto.description);

      if (sets.length === 0) {
        const [group] = await queryRunner.query(
          `SELECT * FROM groups WHERE id = $1`,
          [id],
        );
        return group;
      }

      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE groups SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      try {
        const [rows] = await queryRunner.query(
          `DELETE FROM groups WHERE id = $1 RETURNING id`,
          [id],
        );
        if (rows.length === 0) {
          throw new NotFoundException(`Group ${id} not found`);
        }
      } catch (err) {
        // tickets.group_id has no ON DELETE action (default RESTRICT), unlike
        // ticket_types.default_group_id which is ON DELETE SET NULL -- a
        // group still assigned to tickets can't be deleted outright.
        if ((err as { code?: string }).code === '23503') {
          throw new BadRequestException(
            `Group ${id} is still referenced by existing tickets or ticket types and cannot be deleted`,
          );
        }
        throw err;
      }
    });
  }
}
