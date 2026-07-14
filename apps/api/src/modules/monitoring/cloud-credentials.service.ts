import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import {
  CreateCloudCredentialDto,
  UpdateCloudCredentialDto,
} from './cloud-credentials.dto';

const SAFE_COLUMNS =
  'id, provider, label, is_enabled, last_polled_at, created_at';

@Injectable()
export class CloudCredentialsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** config (the actual secrets) is never returned once written -- same write-only ethos as agent_tokens' signed token. */
  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT ${SAFE_COLUMNS} FROM cloud_credentials ORDER BY created_at`,
      ),
    );
  }

  create(tenantId: string, dto: CreateCloudCredentialDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [row] = await queryRunner.query(
        `INSERT INTO cloud_credentials (tenant_id, provider, label, config) VALUES ($1, $2, $3, $4)
         RETURNING ${SAFE_COLUMNS}`,
        [tenantId, dto.provider, dto.label, JSON.stringify(dto.config)],
      );
      return row;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateCloudCredentialDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM cloud_credentials WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Cloud credential ${id} not found`);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.label !== undefined) assign('label', dto.label);
      if (dto.config !== undefined)
        assign('config', JSON.stringify(dto.config));
      if (dto.isEnabled !== undefined) assign('is_enabled', dto.isEnabled);

      if (sets.length === 0) {
        const [row] = await queryRunner.query(
          `SELECT ${SAFE_COLUMNS} FROM cloud_credentials WHERE id = $1`,
          [id],
        );
        return row;
      }

      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE cloud_credentials SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${SAFE_COLUMNS}`,
        params,
      );
      return rows[0];
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM cloud_credentials WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Cloud credential ${id} not found`);
      }
    });
  }
}
