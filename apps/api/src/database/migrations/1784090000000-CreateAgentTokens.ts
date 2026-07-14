import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Module 2 (Monitoring) Sprint 3 — see
 * docs/Cloud-Ops-Tool-Module2-Monitoring-Scope.md. Unlike agent (web app)
 * and contact (portal) auth, the device JWT this row backs is
 * self-describing (tenantId/resourceId are claims on the signed token, see
 * jwt.ts's signDeviceJwt) rather than looked up from the row -- that's what
 * lets AgentTokenGuard resolve which tenant a request belongs to before any
 * RLS-gated query runs. This table exists purely for revocation
 * (is_enabled) and staleness tracking (last_seen_at), not identity
 * resolution.
 */
export class CreateAgentTokens1784090000000 implements MigrationInterface {
  name = 'CreateAgentTokens1784090000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE agent_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        label text NOT NULL,
        is_enabled boolean NOT NULL DEFAULT true,
        last_seen_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_agent_tokens_tenant_id ON agent_tokens(tenant_id);
      CREATE INDEX idx_agent_tokens_resource_id ON agent_tokens(resource_id);
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON agent_tokens TO app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE agent_tokens ENABLE ROW LEVEL SECURITY;
      ALTER TABLE agent_tokens FORCE ROW LEVEL SECURITY;

      CREATE POLICY tenant_isolation ON agent_tokens
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON agent_tokens;
      ALTER TABLE agent_tokens NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE agent_tokens DISABLE ROW LEVEL SECURITY;
    `);

    await queryRunner.query(`REVOKE ALL PRIVILEGES ON agent_tokens FROM app_user;`);

    await queryRunner.query(`DROP TABLE IF EXISTS agent_tokens;`);
  }
}
