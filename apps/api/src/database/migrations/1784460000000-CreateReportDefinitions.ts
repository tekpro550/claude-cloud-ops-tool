import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Custom report builder (Freshdesk parity): a tenant-saved, re-runnable
 * definition -- metric + group-by + filters + date range over tickets. The
 * whole thing is one jsonb `config` column because the shape is owned by
 * report-builder.ts's allowlist, not the schema; report-builder.ts is what
 * actually constrains which tokens can appear in it and turns them into SQL,
 * never the raw config values themselves.
 */
export class CreateReportDefinitions1784460000000 implements MigrationInterface {
  name = 'CreateReportDefinitions1784460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE report_definitions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        config jsonb NOT NULL,
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_report_definitions_tenant_id ON report_definitions (tenant_id);
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON report_definitions TO app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE report_definitions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE report_definitions FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON report_definitions
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON report_definitions;
      ALTER TABLE report_definitions NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE report_definitions DISABLE ROW LEVEL SECURITY;
    `);
    await queryRunner.query(
      `REVOKE ALL PRIVILEGES ON report_definitions FROM app_user;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS report_definitions;`);
  }
}
