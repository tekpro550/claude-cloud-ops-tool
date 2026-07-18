import { MigrationInterface, QueryRunner } from 'typeorm';

const RLS_TABLES = [
  'apm_ingest_keys',
  'apm_traces',
  'apm_spans',
  'rum_app_keys',
  'rum_events',
];

/**
 * Site24x7-style APM (server traces/spans, apdex + latency percentiles) and
 * RUM (browser page-load timings + JS errors) -- ingestion, storage, and
 * aggregation only, not a language-specific auto-instrumentation agent (see
 * docs/apm-rum-integration.md for the copy-paste middleware/beacon this
 * ships instead). `apm_ingest_keys`/`rum_app_keys` follow log_sources'
 * precedent: no token/hash column -- the ingest credential is a
 * self-describing signed JWT (kind: 'apm_ingest' / 'rum_app', see jwt.ts),
 * so the ingestion guards never need an RLS-gated cross-tenant lookup
 * before the tenant is known. `apm_spans.parent_span_id` deliberately has
 * no FK -- a trace's spans are inserted together with client-supplied span
 * ids resolved to server uuids in application code (see apm.service.ts),
 * and enforcing referential integrity there would require either a second
 * pass or a deferred constraint for no real safety benefit (an orphaned
 * parent_span_id just renders as a broken waterfall edge, never corrupts
 * tenant isolation).
 */
export class CreateApmRum1784490000000 implements MigrationInterface {
  name = 'CreateApmRum1784490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE apm_ingest_keys (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        service text NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_apm_ingest_keys_tenant_id ON apm_ingest_keys(tenant_id);

      CREATE TABLE apm_traces (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        service text NOT NULL,
        transaction text NOT NULL,
        ts timestamptz NOT NULL DEFAULT now(),
        duration_ms int NOT NULL,
        status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error')),
        root boolean NOT NULL DEFAULT true
      );
      -- Percentile/apdex aggregation queries filter by (tenant, service,
      -- transaction) and a time window, ordered by duration for the
      -- percentile scan.
      CREATE INDEX idx_apm_traces_service_ts ON apm_traces (tenant_id, service, transaction, ts DESC);

      CREATE TABLE apm_spans (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        trace_id uuid NOT NULL REFERENCES apm_traces(id) ON DELETE CASCADE,
        parent_span_id uuid,
        name text NOT NULL,
        kind text NOT NULL DEFAULT 'internal',
        duration_ms int NOT NULL,
        attributes jsonb NOT NULL DEFAULT '{}'
      );
      CREATE INDEX idx_apm_spans_trace_id ON apm_spans (trace_id);

      CREATE TABLE rum_app_keys (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        app_name text NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_rum_app_keys_tenant_id ON rum_app_keys(tenant_id);

      CREATE TABLE rum_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        rum_app_key_id uuid NOT NULL REFERENCES rum_app_keys(id) ON DELETE CASCADE,
        ts timestamptz NOT NULL DEFAULT now(),
        page text NOT NULL,
        metric text NOT NULL CHECK (metric IN ('lcp', 'fcp', 'ttfb', 'js_error')),
        value double precision NOT NULL,
        user_agent text,
        attributes jsonb NOT NULL DEFAULT '{}'
      );
      CREATE INDEX idx_rum_events_page_ts ON rum_events (tenant_id, page, metric, ts DESC);
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON apm_ingest_keys, apm_traces, apm_spans, rum_app_keys, rum_events TO app_user;`,
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
      `REVOKE ALL PRIVILEGES ON apm_ingest_keys, apm_traces, apm_spans, rum_app_keys, rum_events FROM app_user;`,
    );
    await queryRunner.query(`
      DROP TABLE IF EXISTS rum_events;
      DROP TABLE IF EXISTS rum_app_keys;
      DROP TABLE IF EXISTS apm_spans;
      DROP TABLE IF EXISTS apm_traces;
      DROP TABLE IF EXISTS apm_ingest_keys;
    `);
  }
}
