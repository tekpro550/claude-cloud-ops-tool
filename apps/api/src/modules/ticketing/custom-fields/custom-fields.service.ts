import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import {
  CreateCustomFieldDto,
  UpdateCustomFieldDto,
} from './custom-fields.dto';
import { CustomFieldDef } from './custom-field-validate';

/**
 * CRUD for ticket custom-field definitions. The value validation that runs on
 * ticket create/update lives in TicketsService (which owns the write), using
 * loadDefs() here + the pure validateCustomFields() helper.
 */
@Injectable()
export class CustomFieldsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Shared with TicketsService: the active + inactive defs for a tenant. */
  static loadDefs(queryRunner: QueryRunner): Promise<CustomFieldDef[]> {
    return queryRunner.query(
      `SELECT key, label, field_type, options, is_required, is_active
       FROM ticket_custom_field_defs ORDER BY position, created_at`,
    );
  }

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT * FROM ticket_custom_field_defs ORDER BY position, created_at`,
      ),
    );
  }

  create(tenantId: string, dto: CreateCustomFieldDto) {
    if (dto.fieldType === 'dropdown' && (dto.options ?? []).length === 0) {
      throw new BadRequestException(
        'A dropdown custom field needs at least one option',
      );
    }
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM ticket_custom_field_defs WHERE key = $1`,
        [dto.key],
      );
      if (existing) {
        throw new BadRequestException(
          `A custom field with key "${dto.key}" already exists`,
        );
      }
      const [row] = await queryRunner.query(
        `INSERT INTO ticket_custom_field_defs (tenant_id, key, label, field_type, options, is_required, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          tenantId,
          dto.key,
          dto.label,
          dto.fieldType,
          dto.options ?? [],
          dto.isRequired ?? false,
          dto.position ?? 0,
        ],
      );
      return row;
    });
  }

  update(tenantId: string, id: string, dto: UpdateCustomFieldDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.label !== undefined) assign('label', dto.label);
      if (dto.options !== undefined) assign('options', dto.options);
      if (dto.isRequired !== undefined) assign('is_required', dto.isRequired);
      if (dto.isActive !== undefined) assign('is_active', dto.isActive);
      if (dto.position !== undefined) assign('position', dto.position);

      if (sets.length === 0) {
        const [row] = await queryRunner.query(
          `SELECT * FROM ticket_custom_field_defs WHERE id = $1`,
          [id],
        );
        if (!row) throw new NotFoundException(`Custom field ${id} not found`);
        return row;
      }
      sets.push('updated_at = now()');
      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE ticket_custom_field_defs SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      if (!rows[0]) throw new NotFoundException(`Custom field ${id} not found`);
      return rows[0];
    });
  }

  remove(tenantId: string, id: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM ticket_custom_field_defs WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Custom field ${id} not found`);
      }
    });
  }
}
