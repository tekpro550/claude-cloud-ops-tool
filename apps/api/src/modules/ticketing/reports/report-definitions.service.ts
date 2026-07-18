import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { buildReportQuery, ReportConfig } from './report-builder';
import { CreateReportDefinitionDto } from './report-definitions.dto';

@Injectable()
export class ReportDefinitionsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT * FROM report_definitions ORDER BY created_at DESC`,
      ),
    );
  }

  create(tenantId: string, dto: CreateReportDefinitionDto, createdBy?: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      // Runs the query once up front purely to validate the config (an
      // out-of-allowlist token throws BadRequestException before anything is
      // saved) -- a saved definition should never be one that 400s on first run.
      buildReportQuery(dto.config);
      const [definition] = await queryRunner.query(
        `INSERT INTO report_definitions (tenant_id, name, config, created_by)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [tenantId, dto.name, JSON.stringify(dto.config), createdBy ?? null],
      );
      return definition;
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM report_definitions WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Report definition ${id} not found`);
      }
    });
  }

  /** Runs a config without saving it -- same execution path run() uses for a saved definition. */
  preview(tenantId: string, config: ReportConfig) {
    const { sql, params } = buildReportQuery(config);
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(sql, params),
    );
  }

  async run(tenantId: string, id: string) {
    const definition = await withTenantContext(
      this.dataSource,
      tenantId,
      async (queryRunner) => {
        const [row] = await queryRunner.query(
          `SELECT * FROM report_definitions WHERE id = $1`,
          [id],
        );
        if (!row) {
          throw new NotFoundException(`Report definition ${id} not found`);
        }
        return row;
      },
    );
    const rows = await this.preview(tenantId, definition.config);
    return { definition, rows };
  }
}
