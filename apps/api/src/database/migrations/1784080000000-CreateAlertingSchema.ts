import { MigrationInterface, QueryRunner } from 'typeorm';

const RLS_TABLES = ['alert_rules', 'alerts'];

/**
 * Module 2 (Monitoring) Sprint 2 — see
 * docs/Cloud-Ops-Tool-Module2-Monitoring-Scope.md sections 3 and 5. One
 * alert_rule per monitor (enforced by the unique index below) rather than a
 * multi-rule-per-monitor design, since the per-monitor debounce threshold
 * already lives on monitors.consecutive_failures_to_alert from Sprint 1 --
 * a rule just says what severity/condition applies once that threshold is
 * hit, not a second, competing threshold.
 *
 * The partial unique index on alerts(monitor_id) WHERE status IN ('open',
 * 'acknowledged') is what makes alert-to-ticket linking idempotent at the
 * database layer: two concurrent evaluations of the same failing monitor
 * can't both insert a new active alert, so there's no race that could
 * create two tickets for one incident. 'acknowledged' is included alongside
 * 'open' so a human acknowledging an alert doesn't reopen the door to a
 * second, duplicate alert for the same still-failing monitor.
 */
export class CreateAlertingSchema1784080000000 implements MigrationInterface {
  name = 'CreateAlertingSchema1784080000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE alert_severity_enum AS ENUM ('info', 'warning', 'critical');
      CREATE TYPE alert_status_enum AS ENUM ('open', 'acknowledged', 'resolved');

      CREATE TABLE alert_rules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        monitor_id uuid NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        condition jsonb NOT NULL DEFAULT '{"statusIn": ["down", "critical"]}',
        severity alert_severity_enum NOT NULL DEFAULT 'critical',
        is_enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (monitor_id)
      );
      CREATE INDEX idx_alert_rules_tenant_id ON alert_rules(tenant_id);

      CREATE TABLE alerts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        monitor_id uuid NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        alert_rule_id uuid REFERENCES alert_rules(id) ON DELETE SET NULL,
        severity alert_severity_enum NOT NULL,
        status alert_status_enum NOT NULL DEFAULT 'open',
        reason_text text NOT NULL,
        repeat_count int NOT NULL DEFAULT 0,
        ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL,
        opened_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        acknowledged_at timestamptz,
        resolved_at timestamptz
      );
      CREATE INDEX idx_alerts_tenant_id ON alerts(tenant_id);
      CREATE INDEX idx_alerts_monitor_id ON alerts(monitor_id);
      -- Enforces "at most one active (open or acknowledged) alert per monitor" -- see class doc comment.
      CREATE UNIQUE INDEX idx_alerts_one_active_per_monitor ON alerts(monitor_id) WHERE status IN ('open', 'acknowledged');
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON alert_rules, alerts TO app_user;`,
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
      `REVOKE ALL PRIVILEGES ON alert_rules, alerts FROM app_user;`,
    );

    await queryRunner.query(`
      DROP TABLE IF EXISTS alerts;
      DROP TABLE IF EXISTS alert_rules;
      DROP TYPE IF EXISTS alert_status_enum;
      DROP TYPE IF EXISTS alert_severity_enum;
    `);
  }
}
