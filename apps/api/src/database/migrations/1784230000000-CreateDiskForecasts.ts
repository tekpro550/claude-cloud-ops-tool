import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Disk-full forecasts (review gap: "trivial linear fit on existing agent
 * data; high value"). One row per server_agent monitor projected to fill
 * within the alert horizon, deduped by a unique index on monitor_id so a
 * re-sweep refreshes the projection in place. Own open/dismissed lifecycle,
 * same shape as cost_anomalies.
 */
export class CreateDiskForecasts1784230000000 implements MigrationInterface {
  name = 'CreateDiskForecasts1784230000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE disk_forecast_status_enum AS ENUM ('open', 'dismissed');

      CREATE TABLE disk_forecasts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        monitor_id uuid NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        resource_id uuid REFERENCES resources(id) ON DELETE SET NULL,
        current_pct numeric NOT NULL,
        rate_per_day numeric NOT NULL,
        days_to_full numeric NOT NULL,
        reason_text text NOT NULL,
        status disk_forecast_status_enum NOT NULL DEFAULT 'open',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_disk_forecasts_tenant_id ON disk_forecasts(tenant_id);
      CREATE UNIQUE INDEX idx_disk_forecasts_monitor ON disk_forecasts(monitor_id);
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON disk_forecasts TO app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE disk_forecasts ENABLE ROW LEVEL SECURITY;
      ALTER TABLE disk_forecasts FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON disk_forecasts
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON disk_forecasts;
      ALTER TABLE disk_forecasts NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE disk_forecasts DISABLE ROW LEVEL SECURITY;
    `);
    await queryRunner.query(
      `REVOKE ALL PRIVILEGES ON disk_forecasts FROM app_user;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS disk_forecasts;`);
    await queryRunner.query(`DROP TYPE IF EXISTS disk_forecast_status_enum;`);
  }
}
