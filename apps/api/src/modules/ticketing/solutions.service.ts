import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { CreateSolutionDto, UpdateSolutionDto } from './solutions.dto';

@Injectable()
export class SolutionsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // Agent-facing: every article, published or draft.
  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`SELECT * FROM solutions ORDER BY updated_at DESC`),
    );
  }

  async get(tenantId: string, id: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [solution] = await queryRunner.query(
        `SELECT * FROM solutions WHERE id = $1`,
        [id],
      );
      if (!solution) {
        throw new NotFoundException(`Solution ${id} not found`);
      }
      return solution;
    });
  }

  create(tenantId: string, dto: CreateSolutionDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [solution] = await queryRunner.query(
        `INSERT INTO solutions (tenant_id, title, body, is_published) VALUES ($1, $2, $3, $4) RETURNING *`,
        [tenantId, dto.title, dto.body, dto.isPublished ?? false],
      );
      return solution;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateSolutionDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM solutions WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Solution ${id} not found`);
      }

      const sets: string[] = ['updated_at = now()'];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.title !== undefined) assign('title', dto.title);
      if (dto.body !== undefined) assign('body', dto.body);
      if (dto.isPublished !== undefined)
        assign('is_published', dto.isPublished);

      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE solutions SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM solutions WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Solution ${id} not found`);
      }
    });
  }
}
