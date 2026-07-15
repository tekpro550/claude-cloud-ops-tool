import { MigrationInterface, QueryRunner } from 'typeorm';

const RLS_TABLES = ['rightsizing_recommendations'];

/**
 * Module 3 (Cost/FinOps) Sprint 4 — see
 * docs/Cloud-Ops-Tool-Module3-Cost-FinOps-Scope.md section 3. Same
 * "at most one active row per subject, enforced by a partial unique index"
 * idempotency pattern as Module 2's alerts(monitor_id) WHERE status IN
 * ('open', 'acknowledged') -- here it's rightsizing_recommendations(resource_id)
 * WHERE status = 'open', since the sweep (Sprint 4's recommendation-sweep
 * job) reruns on a schedule and must update an existing open recommendation
 * in place rather than create a second one for the same resource.
 *
 * estimated_monthly_saving is nullable and, for now, always left null on
 * insert: cost_line_items is billing-API granularity (per service/region/day
 * for a whole cloud_credentials account), not per-instance, so there's no
 * reliable way yet to attribute a dollar saving to one specific resource.
 * Scope doc section 3 already models this column as nullable for exactly
 * this reason ("null until..." is the same shape cost_savings_log's
 * actual_monthly_saving uses in Sprint 5).
 */
export class CreateRightsizingRecommendations1784150000000 implements MigrationInterface {
  name = 'CreateRightsizingRecommendations1784150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE rightsizing_recommendation_type_enum AS ENUM ('rightsize', 'idle', 'terminate');
      CREATE TYPE rightsizing_recommendation_status_enum AS ENUM ('open', 'dismissed', 'ticket_created', 'resolved');

      CREATE TABLE rightsizing_recommendations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        recommendation_type rightsizing_recommendation_type_enum NOT NULL,
        reason_text text NOT NULL,
        estimated_monthly_saving numeric,
        status rightsizing_recommendation_status_enum NOT NULL DEFAULT 'open',
        ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_rightsizing_recommendations_tenant_id ON rightsizing_recommendations(tenant_id);
      CREATE INDEX idx_rightsizing_recommendations_resource_id ON rightsizing_recommendations(resource_id);
      -- At most one open recommendation per resource -- see class doc comment.
      CREATE UNIQUE INDEX idx_rightsizing_recommendations_one_open_per_resource ON rightsizing_recommendations(resource_id) WHERE status = 'open';
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON rightsizing_recommendations TO app_user;`,
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
      `REVOKE ALL PRIVILEGES ON rightsizing_recommendations FROM app_user;`,
    );

    await queryRunner.query(`
      DROP TABLE IF EXISTS rightsizing_recommendations;
      DROP TYPE IF EXISTS rightsizing_recommendation_status_enum;
      DROP TYPE IF EXISTS rightsizing_recommendation_type_enum;
    `);
  }
}
