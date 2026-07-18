import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { ReportGeneratorService } from './report-generator.service';
import { toCsv, toPdf } from './report-export';
import { nextRunAt } from './report-schedule';
import { CreateScheduledReportDto } from './scheduled-reports.dto';

export interface RenderedReportFile {
  buffer: Buffer;
  contentType: string;
  filename: string;
}

@Injectable()
export class ScheduledReportsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly generator: ReportGeneratorService,
  ) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT * FROM scheduled_reports ORDER BY created_at DESC`,
      ),
    );
  }

  create(tenantId: string, dto: CreateScheduledReportDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      // First scheduled send happens after one full cadence period, not
      // immediately -- an admin who wants a copy right away uses runNow.
      const firstRun = nextRunAt(dto.cadence, new Date());
      const [report] = await queryRunner.query(
        `INSERT INTO scheduled_reports (
           tenant_id, name, report_kind, params, format, cadence, recipients, next_run_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          tenantId,
          dto.name,
          dto.reportKind,
          JSON.stringify(dto.params ?? {}),
          dto.format,
          dto.cadence,
          dto.recipients,
          firstRun,
        ],
      );
      return report;
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM scheduled_reports WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Scheduled report ${id} not found`);
      }
    });
  }

  /** Generates the report right now, for immediate download -- doesn't touch last_run_at/next_run_at, which only the sweep advances. */
  async runNow(tenantId: string, id: string): Promise<RenderedReportFile> {
    const report = await withTenantContext(
      this.dataSource,
      tenantId,
      async (queryRunner) => {
        const [row] = await queryRunner.query(
          `SELECT * FROM scheduled_reports WHERE id = $1`,
          [id],
        );
        if (!row) {
          throw new NotFoundException(`Scheduled report ${id} not found`);
        }
        return row;
      },
    );
    return this.render(tenantId, report);
  }

  async render(
    tenantId: string,
    report: {
      report_kind: string;
      params: Record<string, unknown>;
      format: 'csv' | 'pdf';
      name: string;
    },
  ): Promise<RenderedReportFile> {
    const table = await this.generator.generate(
      tenantId,
      report.report_kind,
      report.params ?? {},
    );
    const safeName = report.name.replace(/[^\w.-]+/g, '_');
    if (report.format === 'csv') {
      return {
        buffer: Buffer.from(toCsv(table), 'utf8'),
        contentType: 'text/csv',
        filename: `${safeName}.csv`,
      };
    }
    return {
      buffer: await toPdf(table),
      contentType: 'application/pdf',
      filename: `${safeName}.pdf`,
    };
  }
}
