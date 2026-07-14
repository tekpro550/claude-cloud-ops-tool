import { MigrationInterface, QueryRunner } from 'typeorm';

const RLS_TABLES = ['monitors', 'monitor_checks'];

/**
 * Module 2 (Monitoring) Sprint 1 — see
 * docs/Cloud-Ops-Tool-Module2-Monitoring-Scope.md section 3. `monitors` is a
 * normal low-volume config table; `monitor_checks` is the append-only,
 * high-volume result log every check writes to (one row per check run, no
 * updates or deletes from the app).
 */
export class CreateMonitoringSchema1784070000000 implements MigrationInterface {
  name = 'CreateMonitoringSchema1784070000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE monitor_type_enum AS ENUM ('http', 'ping', 'port', 'dns', 'ssl', 'server_agent', 'cloud_metric');
      CREATE TYPE monitor_status_enum AS ENUM ('up', 'down', 'critical', 'trouble');

      CREATE TABLE monitors (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        name text NOT NULL,
        monitor_type monitor_type_enum NOT NULL,
        config jsonb NOT NULL DEFAULT '{}',
        interval_seconds int NOT NULL DEFAULT 60,
        consecutive_failures_to_alert int NOT NULL DEFAULT 2,
        is_enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_monitors_tenant_id ON monitors(tenant_id);
      CREATE INDEX idx_monitors_resource_id ON monitors(resource_id);

      CREATE TABLE monitor_checks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        monitor_id uuid NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        status monitor_status_enum NOT NULL,
        response_time_ms int,
        raw_output jsonb NOT NULL DEFAULT '{}',
        checked_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_monitor_checks_tenant_id ON monitor_checks(tenant_id);
      -- Scheduler "is this monitor due" queries and dashboard "latest check
      -- for this monitor" queries both filter by monitor_id and sort by
      -- checked_at, so a composite index covers both instead of two.
      CREATE INDEX idx_monitor_checks_monitor_id_checked_at ON monitor_checks(monitor_id, checked_at DESC);
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON monitors, monitor_checks TO app_user;`,
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
      `REVOKE ALL PRIVILEGES ON monitors, monitor_checks FROM app_user;`,
    );

    await queryRunner.query(`
      DROP TABLE IF EXISTS monitor_checks;
      DROP TABLE IF EXISTS monitors;
      DROP TYPE IF EXISTS monitor_status_enum;
      DROP TYPE IF EXISTS monitor_type_enum;
    `);
  }
}
