import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Commitment (Reserved Instance / Savings Plan) management, CloudSpend's
 * headline FinOps feature: recommend a commitment level from on-demand usage,
 * then report coverage/utilization for commitments the tenant actually owns.
 *
 * cost_line_items has no per-instance-family granularity (see
 * cost-savings-estimate.ts's own doc comment on the same limitation) -- the
 * finest scope available is (cloud_credential_id, service, region), so that's
 * what a commitment covers here rather than a specific instance type.
 * `hourly_commitment` mirrors AWS Savings Plans' actual unit (a $/hour
 * commitment that discounts usage up to that hourly rate, with any excess
 * billed on-demand); commitments.service.ts derives a daily $ amount from it
 * for coverage/utilization math against cost_line_items' daily granularity.
 */
export class CreateCommitments1784430000000 implements MigrationInterface {
  name = 'CreateCommitments1784430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE commitments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        cloud_credential_id uuid NOT NULL REFERENCES cloud_credentials(id) ON DELETE CASCADE,
        kind text NOT NULL CHECK (kind IN ('reserved_instance', 'savings_plan')),
        service text NOT NULL,
        region text,
        term_months int NOT NULL CHECK (term_months IN (12, 36)),
        payment_option text NOT NULL DEFAULT 'no_upfront'
          CHECK (payment_option IN ('no_upfront', 'partial_upfront', 'all_upfront')),
        hourly_commitment numeric NOT NULL CHECK (hourly_commitment > 0),
        start_date date NOT NULL,
        end_date date NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (end_date > start_date)
      );
      CREATE INDEX idx_commitments_tenant_id ON commitments (tenant_id);
      CREATE INDEX idx_commitments_credential_scope
        ON commitments (cloud_credential_id, service, region);

      CREATE TABLE commitment_recommendations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        cloud_credential_id uuid NOT NULL REFERENCES cloud_credentials(id) ON DELETE CASCADE,
        kind text NOT NULL CHECK (kind IN ('reserved_instance', 'savings_plan')),
        service text NOT NULL,
        region text,
        recommended_hourly_commitment numeric NOT NULL,
        estimated_monthly_savings numeric NOT NULL,
        break_even_months numeric,
        based_on_days int NOT NULL,
        status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed')),
        generated_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_commitment_recs_tenant_id ON commitment_recommendations (tenant_id);
      -- A plain UNIQUE(...region...) wouldn't dedupe NULL regions against each
      -- other (NULL <> NULL), same pitfall cost_line_items already avoids --
      -- COALESCE region to '' the same way its unique index does.
      CREATE UNIQUE INDEX idx_commitment_recs_scope
        ON commitment_recommendations (cloud_credential_id, service, COALESCE(region, ''), kind);
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON commitments, commitment_recommendations TO app_user;`,
    );

    for (const table of ['commitments', 'commitment_recommendations']) {
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
    for (const table of ['commitments', 'commitment_recommendations']) {
      await queryRunner.query(`
        DROP POLICY IF EXISTS tenant_isolation ON ${table};
        ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY;
        ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;
      `);
      await queryRunner.query(
        `REVOKE ALL PRIVILEGES ON ${table} FROM app_user;`,
      );
    }
    await queryRunner.query(`DROP TABLE IF EXISTS commitment_recommendations;`);
    await queryRunner.query(`DROP TABLE IF EXISTS commitments;`);
  }
}
