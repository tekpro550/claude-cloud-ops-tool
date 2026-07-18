import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Scheduled, exported cost reports -- CloudSpend/Freshdesk-style "generate on
 * a cron, export CSV/PDF, email it to recipients". report_kind is
 * intentionally an open CHECK list rather than a fixed enum type so a later
 * migration can extend it (e.g. a saved custom ticket report from the report
 * builder) without touching this table's shape -- see
 * ReportGeneratorService's own doc comment for the cross-module boundary
 * that a ticket-sourced report_kind would have to cross.
 */
export class CreateScheduledReports1784450000000 implements MigrationInterface {
  name = 'CreateScheduledReports1784450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE scheduled_reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        report_kind text NOT NULL
          CHECK (report_kind IN ('cost_dashboard', 'cost_by_service', 'cost_by_tag', 'commitment_coverage')),
        params jsonb NOT NULL DEFAULT '{}',
        format text NOT NULL CHECK (format IN ('csv', 'pdf')),
        cadence text NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly')),
        recipients text[] NOT NULL,
        last_run_at timestamptz,
        next_run_at timestamptz NOT NULL DEFAULT now(),
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_scheduled_reports_tenant_id ON scheduled_reports (tenant_id);
      CREATE INDEX idx_scheduled_reports_due
        ON scheduled_reports (next_run_at) WHERE is_active = true;
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON scheduled_reports TO app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE scheduled_reports ENABLE ROW LEVEL SECURITY;
      ALTER TABLE scheduled_reports FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON scheduled_reports
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON scheduled_reports;
      ALTER TABLE scheduled_reports NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE scheduled_reports DISABLE ROW LEVEL SECURITY;
    `);
    await queryRunner.query(
      `REVOKE ALL PRIVILEGES ON scheduled_reports FROM app_user;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS scheduled_reports;`);
  }
}
