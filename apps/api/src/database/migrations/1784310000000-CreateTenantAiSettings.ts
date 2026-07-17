import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-tenant AI-assist provider configuration (the "choose the model + supply
 * an API key in admin" ask). One row per tenant. `provider` distinguishes a
 * closed hosted model (anthropic, openai) from an open / self-hosted one
 * exposed over an OpenAI-compatible endpoint (openai_compatible, e.g. Ollama,
 * vLLM, LM Studio). The API key is stored pgcrypto-encrypted at rest in
 * api_key_encrypted (same envelope scheme as cloud_credentials), never as
 * plaintext, and is never returned by the API. RLS-scoped like the rest of the
 * tenant data.
 */
export class CreateTenantAiSettings1784310000000 implements MigrationInterface {
  name = 'CreateTenantAiSettings1784310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tenant_ai_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
        provider text NOT NULL DEFAULT 'anthropic'
          CHECK (provider IN ('anthropic', 'openai', 'openai_compatible')),
        model text NOT NULL,
        base_url text,
        api_key_encrypted bytea,
        is_enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_ai_settings TO app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE tenant_ai_settings ENABLE ROW LEVEL SECURITY;
      ALTER TABLE tenant_ai_settings FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON tenant_ai_settings
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON tenant_ai_settings;
      ALTER TABLE tenant_ai_settings NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE tenant_ai_settings DISABLE ROW LEVEL SECURITY;
    `);
    await queryRunner.query(
      `REVOKE ALL PRIVILEGES ON tenant_ai_settings FROM app_user;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS tenant_ai_settings;`);
  }
}
