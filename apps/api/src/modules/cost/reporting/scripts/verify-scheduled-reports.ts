import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { CommitmentsService } from '../../commitments/commitments.service';
import { nextRunAt } from '../report-schedule';
import { toCsv } from '../report-export';
import { ReportGeneratorService } from '../report-generator.service';
import { ScheduledReportSweepService } from '../scheduled-report-sweep.service';
import { ScheduledReportsService } from '../scheduled-reports.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Scheduled reports verification FAILED: ${message}`);
  }
  console.log(`  OK  ${message}`);
}

function migratorClient() {
  return new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? 'cloud_ops_tool',
    user: process.env.DB_MIGRATOR_USER ?? 'postgres',
    password: process.env.DB_MIGRATOR_PASSWORD ?? 'postgres',
  });
}

async function waitForStatus(migrator: Client, id: string, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await migrator.query(
      `SELECT status, payload FROM notifications WHERE id = $1`,
      [id],
    );
    if (rows[0] && rows[0].status !== 'queued') return rows[0];
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for notification ${id} to leave "queued"`);
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  // ---- Pure function unit tests ----
  const csv = toCsv({
    title: 'x',
    columns: ['Service', 'Notes'],
    rows: [
      ['EC2', 'has, a comma'],
      ['S3', 'has a "quote"'],
    ],
  });
  const csvLines = csv.split('\n');
  assert(
    csvLines[0] === 'Service,Notes' &&
      csvLines[1] === 'EC2,"has, a comma"' &&
      csvLines[2] === 'S3,"has a ""quote"""',
    'toCsv escapes commas and quotes per RFC 4180',
  );

  const daily = nextRunAt('daily', new Date('2026-01-15T00:00:00Z'));
  const weekly = nextRunAt('weekly', new Date('2026-01-15T00:00:00Z'));
  const monthly = nextRunAt('monthly', new Date('2026-01-15T00:00:00Z'));
  assert(
    iso(daily) === '2026-01-16' &&
      iso(weekly) === '2026-01-22' &&
      iso(monthly) === '2026-02-15',
    'nextRunAt advances daily/weekly/monthly cadences correctly',
  );

  // ---- End-to-end ----
  const migrator = migratorClient();
  await migrator.connect();
  const slug = `scheduled-reports-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Scheduled Reports Verify', slug],
  );
  const tenantId = tenant.id as string;
  const encryptionKey =
    process.env.CREDENTIALS_ENCRYPTION_KEY ??
    'dev-only-credentials-key-change-me-in-prod';
  const {
    rows: [cred],
  } = await migrator.query(
    `INSERT INTO cloud_credentials (tenant_id, provider, label, config_encrypted)
     VALUES ($1, 'aws', 'reports test', pgp_sym_encrypt('{}', $2)) RETURNING id`,
    [tenantId, encryptionKey],
  );
  await migrator.query(
    `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, usage_date, amount)
     VALUES ($1, $2, 'EC2', date_trunc('month', now())::date, 120),
            ($1, $2, 'RDS', date_trunc('month', now())::date, 40)`,
    [tenantId, cred.id],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const generator = app.get(ReportGeneratorService);
  const scheduledReports = app.get(ScheduledReportsService);
  const sweep = app.get(ScheduledReportSweepService);
  const commitments = app.get(CommitmentsService);

  try {
    // ---- Report generators ----
    const costByService = await generator.generate(
      tenantId,
      'cost_by_service',
      {},
    );
    assert(
      costByService.rows.some((r) => r[0] === 'EC2' && r[1] === '120.00') &&
        costByService.rows.some((r) => r[0] === 'RDS' && r[1] === '40.00'),
      'cost_by_service generates a table with each service’s spend',
    );

    const costDashboard = await generator.generate(
      tenantId,
      'cost_dashboard',
      {},
    );
    assert(
      costDashboard.rows.some((r) => r[0] === 'Month to date'),
      'cost_dashboard generates the dashboard summary as a table',
    );

    let missingTagKey: any = null;
    try {
      await generator.generate(tenantId, 'cost_by_tag', {});
    } catch (err) {
      missingTagKey = err;
    }
    assert(
      missingTagKey?.status === 400,
      'cost_by_tag without a params.tagKey is rejected',
    );

    // A commitment for the commitment_coverage report.
    const today = new Date();
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 2);
    await commitments.create(tenantId, {
      cloudCredentialId: cred.id,
      kind: 'savings_plan',
      service: 'EC2',
      termMonths: 12,
      hourlyCommitment: 2,
      startDate: iso(start),
      endDate: iso(today),
    });
    const coverageTable = await generator.generate(
      tenantId,
      'commitment_coverage',
      {},
    );
    assert(
      coverageTable.rows.length === 1 && coverageTable.rows[0][0] === 'EC2',
      'commitment_coverage generates one row per owned commitment',
    );

    // ---- runNow: CSV and PDF, no schedule bookkeeping touched ----
    const scheduledCsv = await scheduledReports.create(tenantId, {
      name: 'EC2 Weekly CSV',
      reportKind: 'cost_by_service',
      format: 'csv',
      cadence: 'daily',
      recipients: ['finance@example.com'],
    });
    assert(
      scheduledCsv.last_run_at === null,
      'a newly created scheduled report has never run',
    );

    const csvFile = await scheduledReports.runNow(tenantId, scheduledCsv.id);
    assert(
      csvFile.contentType === 'text/csv' &&
        csvFile.buffer.toString('utf8').startsWith('Service,Amount'),
      'runNow renders a well-formed CSV file',
    );

    const scheduledPdf = await scheduledReports.create(tenantId, {
      name: 'Cost Dashboard PDF',
      reportKind: 'cost_dashboard',
      format: 'pdf',
      cadence: 'monthly',
      recipients: ['finance@example.com'],
    });
    const pdfFile = await scheduledReports.runNow(tenantId, scheduledPdf.id);
    assert(
      pdfFile.contentType === 'application/pdf' &&
        pdfFile.buffer.length > 0 &&
        pdfFile.buffer.subarray(0, 4).toString('ascii') === '%PDF',
      'runNow renders a non-empty, well-formed PDF file',
    );

    const afterRunNow = await migrator.query(
      `SELECT last_run_at, next_run_at FROM scheduled_reports WHERE id = $1`,
      [scheduledCsv.id],
    );
    assert(
      afterRunNow.rows[0].last_run_at === null,
      'runNow does not touch last_run_at/next_run_at -- only the sweep advances the schedule',
    );

    // ---- Sweep: due reports run, deliver by email with an attachment, and advance the schedule ----
    await migrator.query(
      `UPDATE scheduled_reports SET next_run_at = now() - interval '1 hour' WHERE id = $1`,
      [scheduledCsv.id],
    );
    const swept = await sweep.sweepOnce();
    assert(swept >= 1, 'the sweep processes at least the one due report');

    const afterSweep = await migrator.query(
      `SELECT last_run_at, next_run_at FROM scheduled_reports WHERE id = $1`,
      [scheduledCsv.id],
    );
    assert(
      afterSweep.rows[0].last_run_at !== null,
      'the sweep stamps last_run_at once a due report runs',
    );
    assert(
      new Date(afterSweep.rows[0].next_run_at).getTime() >
        new Date(afterSweep.rows[0].last_run_at).getTime(),
      'the sweep advances next_run_at forward from last_run_at',
    );

    const { rows: notificationRows } = await migrator.query(
      `SELECT id FROM notifications
       WHERE tenant_id = $1 AND recipient = 'finance@example.com' AND template_name = 'cost.scheduled_report'
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    assert(
      notificationRows.length === 1,
      'the sweep enqueues an email notification for the report’s recipient',
    );
    const delivered = await waitForStatus(migrator, notificationRows[0].id);
    assert(
      delivered.status === 'sent',
      `the report email is actually sent through the real dispatch pipeline (got status=${delivered.status})`,
    );
    assert(
      delivered.payload?.attachment?.filename === 'EC2_Weekly_CSV.csv' &&
        typeof delivered.payload?.attachment?.base64 === 'string' &&
        delivered.payload.attachment.base64.length > 0,
      'the sent email carries the rendered report as an attachment',
    );

    // A second sweep immediately after must not re-deliver our report --
    // next_run_at has moved into the future, so it's no longer due.
    await sweep.sweepOnce();
    const stillOneNotification = await migrator.query(
      `SELECT count(*)::int AS n FROM notifications
       WHERE tenant_id = $1 AND recipient = 'finance@example.com' AND template_name = 'cost.scheduled_report'`,
      [tenantId],
    );
    assert(
      stillOneNotification.rows[0].n === 1,
      'a report already delivered this cycle is not re-delivered by an immediate second sweep',
    );

    // ---- RLS isolation ----
    const {
      rows: [otherTenant],
    } = await migrator.query(
      `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
      ['Scheduled Reports Verify Other', `${slug}-other`],
    );
    const otherTenantReports = await scheduledReports.list(otherTenant.id);
    assert(
      otherTenantReports.length === 0,
      'RLS hides one tenant’s scheduled reports from another',
    );

    console.log('\nAll scheduled reports checks passed.');
  } finally {
    await app.close();
    await migrator.query(`DELETE FROM tenants WHERE slug LIKE $1`, [
      `${slug}%`,
    ]);
    await migrator.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
