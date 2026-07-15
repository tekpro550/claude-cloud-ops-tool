import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Module 3 (Cost/FinOps) Sprint 1 — see
 * docs/Cloud-Ops-Tool-Module3-Cost-FinOps-Scope.md sections 3 and 5. One row
 * per connected account per service per region per day; the unique index is
 * what makes the daily billing sync job idempotent (a rerun upserts rather
 * than duplicating), the same guarantee Module 2's alerts partial unique
 * index gives against double-firing. No TimescaleDB/ClickHouse -- see the
 * scope doc's "Notes on scale": even a large tenant's daily volume here is
 * nowhere near what would justify it.
 */
export class CreateCostLineItems1784130000000 implements MigrationInterface {
  name = 'CreateCostLineItems1784130000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE cost_line_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        cloud_credential_id uuid NOT NULL REFERENCES cloud_credentials(id) ON DELETE CASCADE,
        resource_id uuid REFERENCES resources(id) ON DELETE SET NULL,
        service text NOT NULL,
        region text,
        usage_date date NOT NULL,
        amount numeric NOT NULL,
        currency text NOT NULL DEFAULT 'USD',
        raw jsonb NOT NULL DEFAULT '{}',
        synced_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_cost_line_items_tenant_id ON cost_line_items(tenant_id);
      CREATE INDEX idx_cost_line_items_credential_id ON cost_line_items(cloud_credential_id);
      CREATE INDEX idx_cost_line_items_usage_date ON cost_line_items(usage_date);
      -- A plain UNIQUE table constraint can't use expressions, and region
      -- can be NULL (some line items aren't region-scoped) -- COALESCE it
      -- here so two NULL-region rows for the same service/day collide
      -- instead of Postgres treating NULL <> NULL and letting a rerun
      -- insert a duplicate.
      CREATE UNIQUE INDEX idx_cost_line_items_unique_row
        ON cost_line_items (cloud_credential_id, service, COALESCE(region, ''), usage_date);
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON cost_line_items TO app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE cost_line_items ENABLE ROW LEVEL SECURITY;
      ALTER TABLE cost_line_items FORCE ROW LEVEL SECURITY;

      CREATE POLICY tenant_isolation ON cost_line_items
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON cost_line_items;
      ALTER TABLE cost_line_items NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE cost_line_items DISABLE ROW LEVEL SECURITY;
    `);

    await queryRunner.query(
      `REVOKE ALL PRIVILEGES ON cost_line_items FROM app_user;`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS cost_line_items;`);
  }
}
