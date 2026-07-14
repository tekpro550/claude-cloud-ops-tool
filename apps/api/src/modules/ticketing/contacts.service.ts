import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { isEmailValid } from './contact-email-validation';
import { CreateContactDto, UpdateContactDto } from './contacts.dto';

async function assertCompanyBelongsToTenant(
  queryRunner: QueryRunner,
  companyId: string,
): Promise<void> {
  const rows = await queryRunner.query(
    `SELECT 1 FROM companies WHERE id = $1`,
    [companyId],
  );
  if (rows.length === 0) {
    throw new BadRequestException(
      `Company ${companyId} not found for this tenant`,
    );
  }
}

@Injectable()
export class ContactsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string, search?: string, needsAction?: boolean) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) => {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (search) {
        params.push(`%${search}%`);
        conditions.push(
          `(name ILIKE $${params.length} OR email ILIKE $${params.length})`,
        );
      }
      if (needsAction) {
        conditions.push(`email_valid = false`);
      }
      const where = conditions.length
        ? `WHERE ${conditions.join(' AND ')}`
        : '';
      return queryRunner.query(
        `SELECT * FROM contacts ${where} ORDER BY name LIMIT 50`,
        params,
      );
    });
  }

  async get(tenantId: string, id: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [contact] = await queryRunner.query(
        `SELECT * FROM contacts WHERE id = $1`,
        [id],
      );
      if (!contact) {
        throw new NotFoundException(`Contact ${id} not found`);
      }
      return contact;
    });
  }

  create(tenantId: string, dto: CreateContactDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      if (dto.companyId) {
        await assertCompanyBelongsToTenant(queryRunner, dto.companyId);
      }
      const [contact] = await queryRunner.query(
        `INSERT INTO contacts (tenant_id, name, email, phone, company_id, email_valid) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          tenantId,
          dto.name,
          dto.email ?? null,
          dto.phone ?? null,
          dto.companyId ?? null,
          isEmailValid(dto.email),
        ],
      );
      return contact;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateContactDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM contacts WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Contact ${id} not found`);
      }
      if (dto.companyId) {
        await assertCompanyBelongsToTenant(queryRunner, dto.companyId);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.name !== undefined) assign('name', dto.name);
      if (dto.email !== undefined) {
        assign('email', dto.email);
        assign('email_valid', isEmailValid(dto.email));
      }
      if (dto.phone !== undefined) assign('phone', dto.phone);
      if (dto.companyId !== undefined) assign('company_id', dto.companyId);

      if (sets.length === 0) {
        const [contact] = await queryRunner.query(
          `SELECT * FROM contacts WHERE id = $1`,
          [id],
        );
        return contact;
      }

      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE contacts SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }
}
