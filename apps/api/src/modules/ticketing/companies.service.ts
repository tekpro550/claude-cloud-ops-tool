import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { CreateCompanyDto, UpdateCompanyDto } from './companies.dto';

@Injectable()
export class CompaniesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`SELECT * FROM companies ORDER BY name`),
    );
  }

  async get(tenantId: string, id: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [company] = await queryRunner.query(
        `SELECT * FROM companies WHERE id = $1`,
        [id],
      );
      if (!company) {
        throw new NotFoundException(`Company ${id} not found`);
      }
      return company;
    });
  }

  create(tenantId: string, dto: CreateCompanyDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [company] = await queryRunner.query(
        `INSERT INTO companies (tenant_id, name, domain) VALUES ($1, $2, $3) RETURNING *`,
        [tenantId, dto.name, dto.domain ?? null],
      );
      return company;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateCompanyDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM companies WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Company ${id} not found`);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.name !== undefined) assign('name', dto.name);
      if (dto.domain !== undefined) assign('domain', dto.domain);

      if (sets.length === 0) {
        const [company] = await queryRunner.query(
          `SELECT * FROM companies WHERE id = $1`,
          [id],
        );
        return company;
      }

      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE companies SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  // contacts.company_id is ON DELETE SET NULL, so this always succeeds --
  // deleting a company just unlinks its contacts rather than being blocked.
  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM companies WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Company ${id} not found`);
      }
    });
  }
}
