import { MigrationInterface, QueryRunner } from 'typeorm';

const RLS_TABLES = [
  'ticket_presence',
  'automation_rule_applications',
  'ticket_views',
  'ticket_satisfaction_ratings',
];

/**
 * Schema for the four Freshdesk Growth-plan feature gaps identified against
 * this module (collision detection, time-triggered automation, saved
 * ticket views, CSAT surveys) -- see the ticket-module feature-gap
 * comparison this session produced. Social ticketing and the app
 * marketplace are explicitly out of scope per that comparison.
 *
 * automation_trigger_enum already has a 'time_based' value, added
 * speculatively in 1784030000000-AddContactAuthAndSourceDetail.ts and never
 * wired up until now -- reused here rather than adding a new enum value.
 */
export class CreateGrowthPlanFeaturesSchema1784170000000 implements MigrationInterface {
  name = 'CreateGrowthPlanFeaturesSchema1784170000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      -- Time-triggered automation: how long after creation a 'time_based'
      -- rule should fire. NULL for event-triggered rules.
      ALTER TABLE automation_rules ADD COLUMN time_trigger_minutes integer;

      -- One row per (rule, ticket) that a time-based rule has already fired
      -- for -- the sweep's dedupe guard, so a rule fires exactly once per
      -- ticket rather than every sweep pass.
      CREATE TABLE automation_rule_applications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        automation_rule_id uuid NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
        ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX idx_automation_rule_applications_once ON automation_rule_applications(automation_rule_id, ticket_id);
      CREATE INDEX idx_automation_rule_applications_tenant_id ON automation_rule_applications(tenant_id);

      -- Collision detection: a per-(ticket, agent) heartbeat row, upserted
      -- every few seconds while an agent has the ticket open. Presence is
      -- "live" if last_seen_at is recent -- there's no separate is-online
      -- concept, a stale row just ages out and stops being shown.
      CREATE TABLE ticket_presence (
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        is_typing boolean NOT NULL DEFAULT false,
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (ticket_id, agent_id)
      );
      CREATE INDEX idx_ticket_presence_tenant_id ON ticket_presence(tenant_id);

      -- Saved/custom ticket views: an arbitrary filter combination (the
      -- same shape ListTicketsQueryDto already accepts) saved under a name.
      -- agent_id NULL means a shared/team view instead of a personal one.
      CREATE TABLE ticket_views (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        agent_id uuid REFERENCES agents(id) ON DELETE CASCADE,
        name text NOT NULL,
        filters jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_ticket_views_tenant_id ON ticket_views(tenant_id);

      -- CSAT: one satisfaction rating per ticket, submitted by the
      -- requesting contact once the ticket is resolved/closed.
      CREATE TYPE ticket_satisfaction_rating_enum AS ENUM ('happy', 'neutral', 'unhappy');
      CREATE TABLE ticket_satisfaction_ratings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        rating ticket_satisfaction_rating_enum NOT NULL,
        comment text,
        rated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX idx_ticket_satisfaction_ratings_one_per_ticket ON ticket_satisfaction_ratings(ticket_id);
      CREATE INDEX idx_ticket_satisfaction_ratings_tenant_id ON ticket_satisfaction_ratings(tenant_id);
    `);

    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON automation_rule_applications TO app_user;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ticket_presence TO app_user;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ticket_views TO app_user;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ticket_satisfaction_ratings TO app_user;
    `);

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

    await queryRunner.query(`
      REVOKE ALL PRIVILEGES ON ticket_satisfaction_ratings FROM app_user;
      REVOKE ALL PRIVILEGES ON ticket_views FROM app_user;
      REVOKE ALL PRIVILEGES ON ticket_presence FROM app_user;
      REVOKE ALL PRIVILEGES ON automation_rule_applications FROM app_user;
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS ticket_satisfaction_ratings;
      DROP TYPE IF EXISTS ticket_satisfaction_rating_enum;
      DROP TABLE IF EXISTS ticket_views;
      DROP TABLE IF EXISTS ticket_presence;
      DROP TABLE IF EXISTS automation_rule_applications;
      ALTER TABLE automation_rules DROP COLUMN IF EXISTS time_trigger_minutes;
    `);
  }
}
