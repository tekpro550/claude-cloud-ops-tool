import { MigrationInterface, QueryRunner } from 'typeorm';

const RLS_TABLES = ['log_sources', 'log_entries', 'log_alert_rules'];

/**
 * Site24x7-style log management: ingest, search, and threshold-based
 * alerting. `log_sources` deliberately has no token/hash column -- the
 * ingest credential is a self-describing signed JWT (kind: 'log_source',
 * see jwt.ts), the same pattern agent_tokens already uses for the server
 * agent binary, so LogSourceTokenGuard never needs an RLS-gated
 * cross-tenant lookup before it knows which tenant the request belongs to.
 * `log_alert_rules.escalation_policy_id` is schema-only for now (same
 * "column exists for a later wiring, not read yet" precedent as
 * AddContactAuthAndSourceDetail's password_hash/oauth_provider) --
 * log-alert-sweep.service.ts currently always fires by opening a ticket via
 * the internal contract, not by walking the escalation policy's steps.
 */
export class CreateLogManagement1784480000000 implements MigrationInterface {
  name = 'CreateLogManagement1784480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE log_sources (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_log_sources_tenant_id ON log_sources(tenant_id);

      CREATE TABLE log_entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        log_source_id uuid NOT NULL REFERENCES log_sources(id) ON DELETE CASCADE,
        ts timestamptz NOT NULL DEFAULT now(),
        level text NOT NULL DEFAULT 'info'
          CHECK (level IN ('debug', 'info', 'warn', 'error', 'critical')),
        message text NOT NULL,
        attributes jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      -- Source-scoped time-range scans (the search page, the alert sweep's
      -- trailing-window count) both filter by (tenant_id, log_source_id) and
      -- sort/range on ts.
      CREATE INDEX idx_log_entries_source_ts ON log_entries (tenant_id, log_source_id, ts DESC);
      -- Full-text search over message, used by logs.service.ts's search()
      -- via plainto_tsquery.
      CREATE INDEX idx_log_entries_message_fts ON log_entries USING GIN (to_tsvector('english', message));

      CREATE TABLE log_alert_rules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        log_source_id uuid NOT NULL REFERENCES log_sources(id) ON DELETE CASCADE,
        name text NOT NULL,
        match_query text,
        level_at_least text NOT NULL DEFAULT 'error'
          CHECK (level_at_least IN ('debug', 'info', 'warn', 'error', 'critical')),
        window_seconds int NOT NULL DEFAULT 300,
        threshold int NOT NULL DEFAULT 1,
        escalation_policy_id uuid REFERENCES escalation_policies(id) ON DELETE SET NULL,
        is_enabled boolean NOT NULL DEFAULT true,
        last_fired_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_log_alert_rules_tenant_id ON log_alert_rules(tenant_id);
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON log_sources, log_entries, log_alert_rules TO app_user;`,
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
      `REVOKE ALL PRIVILEGES ON log_sources, log_entries, log_alert_rules FROM app_user;`,
    );
    await queryRunner.query(`
      DROP TABLE IF EXISTS log_alert_rules;
      DROP TABLE IF EXISTS log_entries;
      DROP TABLE IF EXISTS log_sources;
    `);
  }
}
