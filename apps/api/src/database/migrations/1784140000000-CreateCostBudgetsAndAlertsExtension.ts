import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Module 3 (Cost/FinOps) Sprint 2 — see
 * docs/Cloud-Ops-Tool-Module3-Cost-FinOps-Scope.md sections 3 and 5.
 *
 * The scope doc said alerts already had two nullable source-reference
 * columns (monitor_id, alert_rule_id) that a cost_budget_id could sit
 * alongside cleanly. Building this sprint found that's only half true:
 * alert_rule_id is nullable, but monitor_id is NOT NULL (Module 2's
 * migration never needed it to be anything else, since every alert used to
 * come from a monitor). A cost alert has no monitor, so monitor_id has to
 * become nullable too, and since alerts never had its own resource_id
 * before (a monitor alert reaches its resource by joining through
 * monitors.resource_id), one is added directly here -- a cost alert has no
 * monitor to join through. The CHECK constraint keeps every alert
 * attributable to exactly one source; the new partial unique index gives
 * cost alerts the same "one active alert per source" guarantee
 * idx_alerts_one_active_per_monitor already gives monitor alerts.
 */
export class CreateCostBudgetsAndAlertsExtension1784140000000 implements MigrationInterface {
  name = 'CreateCostBudgetsAndAlertsExtension1784140000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE cost_budgets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        cloud_credential_id uuid REFERENCES cloud_credentials(id) ON DELETE CASCADE,
        name text NOT NULL,
        monthly_budget_amount numeric,
        pace_warning_threshold_pct int NOT NULL DEFAULT 20,
        pace_critical_threshold_pct int NOT NULL DEFAULT 40,
        notify_channel notification_channel_enum,
        notify_recipient text,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_cost_budgets_tenant_id ON cost_budgets(tenant_id);
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON cost_budgets TO app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE cost_budgets ENABLE ROW LEVEL SECURITY;
      ALTER TABLE cost_budgets FORCE ROW LEVEL SECURITY;

      CREATE POLICY tenant_isolation ON cost_budgets
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
    `);

    await queryRunner.query(`
      ALTER TABLE alerts ALTER COLUMN monitor_id DROP NOT NULL;
      ALTER TABLE alerts ADD COLUMN resource_id uuid REFERENCES resources(id) ON DELETE SET NULL;
      ALTER TABLE alerts ADD COLUMN cost_budget_id uuid REFERENCES cost_budgets(id) ON DELETE SET NULL;
      ALTER TABLE alerts ADD CONSTRAINT alerts_has_a_source
        CHECK (monitor_id IS NOT NULL OR cost_budget_id IS NOT NULL);

      CREATE UNIQUE INDEX idx_alerts_one_active_per_budget
        ON alerts(cost_budget_id) WHERE status IN ('open', 'acknowledged');
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_alerts_one_active_per_budget;
      ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_has_a_source;
      ALTER TABLE alerts DROP COLUMN IF EXISTS cost_budget_id;
      ALTER TABLE alerts DROP COLUMN IF EXISTS resource_id;
      ALTER TABLE alerts ALTER COLUMN monitor_id SET NOT NULL;
    `);

    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON cost_budgets;
      ALTER TABLE cost_budgets NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE cost_budgets DISABLE ROW LEVEL SECURITY;
    `);

    await queryRunner.query(
      `REVOKE ALL PRIVILEGES ON cost_budgets FROM app_user;`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS cost_budgets;`);
  }
}
