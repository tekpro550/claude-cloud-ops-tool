import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { IngestLogEntryDto } from './logs.dto';

@Injectable()
export class LogIngestionService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async ingest(
    tenantId: string,
    logSourceId: string,
    entries: IngestLogEntryDto[],
  ): Promise<void> {
    if (entries.length === 0) return;

    await withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      for (const entry of entries) {
        await queryRunner.query(
          `INSERT INTO log_entries (tenant_id, log_source_id, ts, level, message, attributes)
           VALUES ($1, $2, COALESCE($3::timestamptz, now()), COALESCE($4, 'info'), $5, $6)`,
          [
            tenantId,
            logSourceId,
            entry.ts ?? null,
            entry.level ?? null,
            entry.message,
            JSON.stringify(entry.attributes ?? {}),
          ],
        );
      }
    });
  }
}
