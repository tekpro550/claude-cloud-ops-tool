import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Site24x7-style synthetic / real-browser transaction monitoring: a
 * 'synthetic' monitor_type whose config is an ordered script
 * ({ steps: [...], maxStepMs }, validated by synthetic/synthetic-script.ts's
 * action allowlist, not by the schema). Each run writes the usual
 * monitor_checks row (status/totalMs/raw_output) plus one
 * synthetic_run_steps row per step -- the per-step timing data a waterfall
 * UI needs that monitor_checks alone can't hold.
 */
export class AddSyntheticMonitors1784470000000 implements MigrationInterface {
  name = 'AddSyntheticMonitors1784470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Postgres can't add an enum value and use it in the same transaction,
    // but a plain addition with no immediate use is fine (same pattern as
    // AddContactAuthAndSourceDetail / AddSlackWebhookNotificationChannels).
    await queryRunner.query(
      `ALTER TYPE monitor_type_enum ADD VALUE IF NOT EXISTS 'synthetic'`,
    );

    await queryRunner.query(`
      CREATE TABLE synthetic_run_steps (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        monitor_check_id uuid NOT NULL REFERENCES monitor_checks(id) ON DELETE CASCADE,
        step_index int NOT NULL,
        action text NOT NULL,
        status text NOT NULL,
        duration_ms int,
        error text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_synthetic_run_steps_tenant_id ON synthetic_run_steps(tenant_id);
      -- The waterfall UI reads all steps for one check, in order.
      CREATE INDEX idx_synthetic_run_steps_check_id ON synthetic_run_steps(monitor_check_id, step_index);
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON synthetic_run_steps TO app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE synthetic_run_steps ENABLE ROW LEVEL SECURITY;
      ALTER TABLE synthetic_run_steps FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON synthetic_run_steps
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON synthetic_run_steps;
      ALTER TABLE synthetic_run_steps NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE synthetic_run_steps DISABLE ROW LEVEL SECURITY;
    `);
    await queryRunner.query(
      `REVOKE ALL PRIVILEGES ON synthetic_run_steps FROM app_user;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS synthetic_run_steps;`);
    // Postgres has no DROP VALUE for enums -- 'synthetic' stays defined but
    // unused on rollback (harmless, same convention as
    // AddContactAuthAndSourceDetail's enum additions).
  }
}
