import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import {
  CreateCannedResponseFolderDto,
  UpdateCannedResponseFolderDto,
} from './canned-response-folders.dto';

async function assertAgentBelongsToTenant(
  queryRunner: QueryRunner,
  agentId: string,
): Promise<void> {
  const rows = await queryRunner.query(`SELECT 1 FROM agents WHERE id = $1`, [
    agentId,
  ]);
  if (rows.length === 0) {
    throw new BadRequestException(`Agent ${agentId} not found for this tenant`);
  }
}

@Injectable()
export class CannedResponseFoldersService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`SELECT * FROM canned_response_folders ORDER BY name`),
    );
  }

  create(tenantId: string, dto: CreateCannedResponseFolderDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      if (dto.agentId) {
        await assertAgentBelongsToTenant(queryRunner, dto.agentId);
      }
      const [folder] = await queryRunner.query(
        `INSERT INTO canned_response_folders (tenant_id, agent_id, name) VALUES ($1, $2, $3) RETURNING *`,
        [tenantId, dto.agentId ?? null, dto.name],
      );
      return folder;
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateCannedResponseFolderDto,
  ) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM canned_response_folders WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Canned response folder ${id} not found`);
      }
      if (dto.agentId) {
        await assertAgentBelongsToTenant(queryRunner, dto.agentId);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.name !== undefined) assign('name', dto.name);
      if (dto.agentId !== undefined) assign('agent_id', dto.agentId);

      if (sets.length === 0) {
        const [folder] = await queryRunner.query(
          `SELECT * FROM canned_response_folders WHERE id = $1`,
          [id],
        );
        return folder;
      }

      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE canned_response_folders SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  // canned_responses.folder_id is ON DELETE SET NULL, so this always
  // succeeds -- deleting a folder just moves its responses back to
  // "no folder" rather than being blocked.
  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM canned_response_folders WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Canned response folder ${id} not found`);
      }
    });
  }
}
