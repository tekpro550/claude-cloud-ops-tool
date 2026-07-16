import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cost anomaly detection (review gap: "daily line items make a
 * baseline+deviation sweep straightforward"). One row per detected spend
 * spike on a (credential, service, region, day), deduped by a unique index
 * so a re-sweep updates rather than duplicates. Modelled on
 * rightsizing_recommendations -- its own cost-side table with an open/
 * dismissed lifecycle, not shoehorned into the monitor/budget-scoped alerts
 * table.
 */
export class CreateCostAnomalies1784220000000 implements MigrationInterface {
  name = 'CreateCostAnomalies1784220000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE cost_anomaly_status_enum AS ENUM ('open', 'dismissed');

      CREATE TABLE cost_anomalies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        cloud_credential_id uuid REFERENCES cloud_credentials(id) ON DELETE CASCADE,
        service text NOT NULL,
        region text,
        usage_date date NOT NULL,
        baseline_amount numeric NOT NULL,
        actual_amount numeric NOT NULL,
        deviation_pct numeric NOT NULL,
        reason_text text NOT NULL,
        status cost_anomaly_status_enum NOT NULL DEFAULT 'open',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_cost_anomalies_tenant_id ON cost_anomalies(tenant_id);
      CREATE UNIQUE INDEX idx_cost_anomalies_unique
        ON cost_anomalies (cloud_credential_id, service, COALESCE(region, ''), usage_date);
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON cost_anomalies TO app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE cost_anomalies ENABLE ROW LEVEL SECURITY;
      ALTER TABLE cost_anomalies FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON cost_anomalies
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON cost_anomalies;
      ALTER TABLE cost_anomalies NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE cost_anomalies DISABLE ROW LEVEL SECURITY;
    `);
    await queryRunner.query(
      `REVOKE ALL PRIVILEGES ON cost_anomalies FROM app_user;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS cost_anomalies;`);
    await queryRunner.query(`DROP TYPE IF EXISTS cost_anomaly_status_enum;`);
  }
}
