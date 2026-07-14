import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import {
  CreateCannedResponseDto,
  UpdateCannedResponseDto,
} from './canned-responses.dto';

@Injectable()
export class CannedResponsesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  create(tenantId: string, dto: CreateCannedResponseDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [response] = await queryRunner.query(
        `INSERT INTO canned_responses (tenant_id, title, body, folder_id) VALUES ($1, $2, $3, $4) RETURNING *`,
        [tenantId, dto.title, dto.body, dto.folderId ?? null],
      );
      return response;
    });
  }

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`SELECT * FROM canned_responses ORDER BY title`),
    );
  }

  async update(tenantId: string, id: string, dto: UpdateCannedResponseDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM canned_responses WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Canned response ${id} not found`);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.title !== undefined) assign('title', dto.title);
      if (dto.body !== undefined) assign('body', dto.body);
      if (dto.folderId !== undefined) assign('folder_id', dto.folderId);

      if (sets.length === 0) {
        const [response] = await queryRunner.query(
          `SELECT * FROM canned_responses WHERE id = $1`,
          [id],
        );
        return response;
      }

      sets.push('updated_at = now()');
      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE canned_responses SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM canned_responses WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Canned response ${id} not found`);
      }
    });
  }
}
