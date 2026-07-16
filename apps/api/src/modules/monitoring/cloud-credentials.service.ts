import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import {
  CreateCloudCredentialDto,
  UpdateCloudCredentialDto,
} from './cloud-credentials.dto';
import { credentialsEncryptionKey } from './credentials-crypto';

const SAFE_COLUMNS =
  'id, provider, label, is_enabled, last_polled_at, created_at';

@Injectable()
export class CloudCredentialsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  /** config (the actual secrets) is never returned once written -- and is now stored pgcrypto-encrypted at rest, not as plaintext jsonb. */
  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT ${SAFE_COLUMNS} FROM cloud_credentials ORDER BY created_at`,
      ),
    );
  }

  create(tenantId: string, dto: CreateCloudCredentialDto) {
    const key = credentialsEncryptionKey(this.config);
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [row] = await queryRunner.query(
        `INSERT INTO cloud_credentials (tenant_id, provider, label, config_encrypted)
         VALUES ($1, $2, $3, pgp_sym_encrypt($4, $5))
         RETURNING ${SAFE_COLUMNS}`,
        [tenantId, dto.provider, dto.label, JSON.stringify(dto.config), key],
      );
      return row;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateCloudCredentialDto) {
    const key = credentialsEncryptionKey(this.config);
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
      if (dto.config !== undefined) {
        // Encrypt in the same way create() does: the JSON goes in as $n and
        // the key as $n+1, wrapped in pgp_sym_encrypt so plaintext never
        // lands in the column.
        params.push(JSON.stringify(dto.config));
        const jsonParam = params.length;
        params.push(key);
        const keyParam = params.length;
        sets.push(
          `config_encrypted = pgp_sym_encrypt($${jsonParam}, $${keyParam})`,
        );
      }
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
