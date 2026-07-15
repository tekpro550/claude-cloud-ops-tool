import { MigrationInterface, QueryRunner } from 'typeorm';

const RLS_TABLES = ['cost_savings_log'];

/**
 * Module 3 (Cost/FinOps) Sprint 5 — see
 * docs/Cloud-Ops-Tool-Module3-Cost-FinOps-Scope.md sections 3 and 8.
 *
 * Two discovered deviations from the scope doc, fixed here (same
 * "found mid-build, documented" convention this module has followed
 * throughout):
 *
 * 1. `tenants.financial_year_start_month` already exists -- Module 1's
 *    Foundation schema (1783945249566-CreateFoundationSchema.ts) added it
 *    on day one, default 4, not the doc's assumed "needs to be added in
 *    Sprint 5, default 1". Only `cost_rate_display` is actually new here.
 * 2. `resources` had no link back to the `cloud_credentials` row that
 *    discovered it. Sprints 1-4 never needed one -- the MSP rollup and
 *    rightsizing sweep both operate at the credential level or the
 *    resource level, never both at once. Sprint 5's savings materialization
 *    does need both: to judge whether acting on a recommendation actually
 *    reduced spend, it has to walk from a specific `resources` row back to
 *    the `cost_line_items` for the account that resource belongs to. Added
 *    as a nullable FK (cloud-discovered resources only -- a manually-created
 *    resource, e.g. a website monitor, has no associated billing account)
 *    and stamped by CloudResourcePollerService.upsertResource going forward.
 *
 * cost_savings_log.expected_monthly_saving is NOT NULL by design (per
 * section 3's own schema) -- see rightsizing-sweep.service.ts's
 * estimateMonthlySaving() for how Sprint 4's recommendations now populate a
 * real (heuristic, clearly labeled) number instead of the null Sprint 4
 * originally shipped with, which is what makes logging a savings row
 * possible at all.
 */
export class CreateCostSavingsLogAndTenantSettings1784160000000 implements MigrationInterface {
  name = 'CreateCostSavingsLogAndTenantSettings1784160000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE resources ADD COLUMN cloud_credential_id uuid REFERENCES cloud_credentials(id) ON DELETE SET NULL;
      CREATE INDEX idx_resources_cloud_credential_id ON resources(cloud_credential_id);

      CREATE TYPE cost_savings_status_enum AS ENUM ('logged', 'verified', 'not_materialized');

      CREATE TABLE cost_savings_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        recommendation_id uuid REFERENCES rightsizing_recommendations(id) ON DELETE SET NULL,
        ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL,
        expected_monthly_saving numeric NOT NULL,
        actual_monthly_saving numeric,
        status cost_savings_status_enum NOT NULL DEFAULT 'logged',
        logged_at timestamptz NOT NULL DEFAULT now(),
        verified_at timestamptz
      );
      CREATE INDEX idx_cost_savings_log_tenant_id ON cost_savings_log(tenant_id);
      CREATE INDEX idx_cost_savings_log_resource_id ON cost_savings_log(resource_id);
      -- The materialization sweep's "still logged, past the minimum window" query
      -- filters on status and orders/scans by logged_at.
      CREATE INDEX idx_cost_savings_log_status_logged_at ON cost_savings_log(status, logged_at);
      -- One savings-log row per recommendation -- a recommendation's ticket only
      -- resolves once, so logging happens exactly once per recommendation.
      CREATE UNIQUE INDEX idx_cost_savings_log_one_per_recommendation ON cost_savings_log(recommendation_id) WHERE recommendation_id IS NOT NULL;

      CREATE TYPE cost_rate_display_enum AS ENUM ('list_price', 'negotiated');
      ALTER TABLE tenants ADD COLUMN cost_rate_display cost_rate_display_enum NOT NULL DEFAULT 'list_price';
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON cost_savings_log TO app_user;`,
    );
    // app_user has always been SELECT-only on tenants (it's the migrator's
    // table, not the running app's) -- TenantCostSettingsController is the
    // first thing the app itself needs to write to it, so grant column-level
    // UPDATE on just the two cost-settings columns, not the whole row (slug,
    // plan_tier etc. stay migrator/admin-only).
    await queryRunner.query(
      `GRANT UPDATE (financial_year_start_month, cost_rate_display) ON tenants TO app_user;`,
    );

    for (const table of RLS_TABLES) {
      await queryRunner.query(`
        ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;

        CREATE POLICY tenant_isolation ON ${table}
          USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of RLS_TABLES) {
      await queryRunner.query(`
        DROP POLICY IF EXISTS tenant_isolation ON ${table};
        ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY;
        ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;
      `);
    }

    await queryRunner.query(
      `REVOKE UPDATE (financial_year_start_month, cost_rate_display) ON tenants FROM app_user;`,
    );
    await queryRunner.query(
      `REVOKE ALL PRIVILEGES ON cost_savings_log FROM app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE tenants DROP COLUMN cost_rate_display;
      DROP TYPE IF EXISTS cost_rate_display_enum;

      DROP TABLE IF EXISTS cost_savings_log;
      DROP TYPE IF EXISTS cost_savings_status_enum;

      DROP INDEX IF EXISTS idx_resources_cloud_credential_id;
      ALTER TABLE resources DROP COLUMN cloud_credential_id;
    `);
  }
}
