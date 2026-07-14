import { MigrationInterface, QueryRunner } from 'typeorm';

const RLS_TABLES = [
  'escalation_policies',
  'on_call_schedules',
  'notification_templates',
  'downtime_events',
];

/**
 * Module 2 (Monitoring) Sprint 5 — see
 * docs/Cloud-Ops-Tool-Module2-Monitoring-Scope.md sections 3 and 5.
 * alerts.last_escalated_step is what makes the escalation sweep idempotent
 * the same way tickets.first_response_overdue_notified_at makes the SLA
 * sweep idempotent -- a persisted marker of "how far we've already gotten",
 * not a re-derivation on every pass.
 */
export class CreateEscalationSchema1784110000000 implements MigrationInterface {
  name = 'CreateEscalationSchema1784110000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE escalation_policies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        -- steps: [{ delayMinutes: number, notify: [{ channel, recipient }] }, ...]
        -- ordered by delayMinutes ascending; step 0 conventionally has delayMinutes = 0.
        steps jsonb NOT NULL DEFAULT '[]',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_escalation_policies_tenant_id ON escalation_policies(tenant_id);

      CREATE TABLE on_call_schedules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        -- entries: [{ agentId: uuid, startsAt: ISO string, endsAt: ISO string }, ...]
        entries jsonb NOT NULL DEFAULT '[]',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_on_call_schedules_tenant_id ON on_call_schedules(tenant_id);

      CREATE TABLE notification_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        channel notification_channel_enum NOT NULL,
        event_type text NOT NULL,
        subject text,
        body text NOT NULL,
        is_default boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_notification_templates_tenant_id ON notification_templates(tenant_id);
      -- At most one default template per (channel, event_type) -- lets a
      -- lookup ask for "the" default without an ORDER BY/LIMIT tiebreak.
      CREATE UNIQUE INDEX idx_notification_templates_one_default
        ON notification_templates(tenant_id, channel, event_type) WHERE is_default = true;

      CREATE TABLE downtime_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        monitor_id uuid REFERENCES monitors(id) ON DELETE SET NULL,
        reason text NOT NULL,
        starts_at timestamptz NOT NULL DEFAULT now(),
        ends_at timestamptz,
        is_manual boolean NOT NULL DEFAULT true,
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_downtime_events_tenant_id ON downtime_events(tenant_id);
      CREATE INDEX idx_downtime_events_resource_id ON downtime_events(resource_id);

      ALTER TABLE alert_rules ADD COLUMN escalation_policy_id uuid REFERENCES escalation_policies(id) ON DELETE SET NULL;
      ALTER TABLE alerts ADD COLUMN last_escalated_step int NOT NULL DEFAULT -1;
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON escalation_policies, on_call_schedules, notification_templates, downtime_events TO app_user;`,
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
      `REVOKE ALL PRIVILEGES ON escalation_policies, on_call_schedules, notification_templates, downtime_events FROM app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE alerts DROP COLUMN IF EXISTS last_escalated_step;
      ALTER TABLE alert_rules DROP COLUMN IF EXISTS escalation_policy_id;

      DROP TABLE IF EXISTS downtime_events;
      DROP TABLE IF EXISTS notification_templates;
      DROP TABLE IF EXISTS on_call_schedules;
      DROP TABLE IF EXISTS escalation_policies;
    `);
  }
}
