import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { NotificationsService } from '../../../notifications/notifications.service';
import { nextRunAt, ReportCadence } from './report-schedule';
import { ScheduledReportsService } from './scheduled-reports.service';

interface DueReportRow {
  id: string;
  tenant_id: string;
  name: string;
  report_kind: string;
  params: Record<string, unknown>;
  format: 'csv' | 'pdf';
  cadence: ReportCadence;
  recipients: string[];
}

/**
 * Finds due scheduled_reports, renders them, and emails each recipient with
 * the rendered file as an attachment (see NotificationAttachment /
 * EmailChannel.send) via the normal NotificationsService.enqueue ->
 * event-bus -> NotificationDispatcherService path -- not a direct SMTP call
 * here, same as every other notification in this codebase.
 */
@Injectable()
export class ScheduledReportSweepService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ScheduledReportSweepService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly scheduledReports: ScheduledReportsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>(
      'SCHEDULED_REPORT_SWEEP_INTERVAL_MS',
      3600000, // 1h -- the finest cadence is daily, so hourly polling is plenty
    );
    this.timer = setInterval(() => {
      void this.sweepOnce().catch((err) =>
        this.logger.error(`sweepOnce tick failed: ${(err as Error).message}`),
      );
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweepOnce(): Promise<number> {
    if (this.running) {
      this.logger.warn(
        'scheduled report sweep already in progress, skipping this tick',
      );
      return 0;
    }
    this.running = true;
    try {
      const tenants = await this.dataSource.query(`SELECT id FROM tenants`);
      let count = 0;
      for (const tenant of tenants) {
        try {
          count += await this.sweepTenant(tenant.id);
        } catch (err) {
          this.logger.error(
            `tenant ${tenant.id} sweep failed: ${(err as Error).message}`,
          );
        }
      }
      return count;
    } finally {
      this.running = false;
    }
  }

  private async sweepTenant(tenantId: string): Promise<number> {
    const due: DueReportRow[] = await withTenantContext(
      this.dataSource,
      tenantId,
      (queryRunner) =>
        queryRunner.query(
          `SELECT * FROM scheduled_reports WHERE is_active = true AND next_run_at <= now()`,
        ),
    );

    let count = 0;
    for (const report of due) {
      try {
        await this.runAndDeliver(tenantId, report);
        count++;
      } catch (err) {
        this.logger.error(
          `scheduled report ${report.id} failed: ${(err as Error).message}`,
        );
      }
    }
    return count;
  }

  private async runAndDeliver(
    tenantId: string,
    report: DueReportRow,
  ): Promise<void> {
    const file = await this.scheduledReports.render(tenantId, report);
    const base64 = file.buffer.toString('base64');

    for (const recipient of report.recipients) {
      await this.notifications.enqueue({
        tenantId,
        channel: 'email',
        recipient,
        templateName: 'cost.scheduled_report',
        payload: {
          reportName: report.name,
          format: report.format,
          attachment: {
            filename: file.filename,
            contentType: file.contentType,
            base64,
          },
        },
      });
    }

    const now = new Date();
    await withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `UPDATE scheduled_reports SET last_run_at = $2, next_run_at = $3 WHERE id = $1`,
        [report.id, now, nextRunAt(report.cadence, now)],
      ),
    );
  }
}
