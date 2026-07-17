import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Auth hardening, part two: two-factor auth (TOTP) and OIDC single sign-on.
 *
 * - users gains an encrypted TOTP secret + an enabled flag. The secret is
 *   stored with pgcrypto (same at-rest scheme as cloud credentials), so a DB
 *   dump alone can't reconstruct anyone's authenticator.
 * - tenant_sso_configs holds one tenant's OpenID Connect identity-provider
 *   settings (issuer, endpoints, client id, encrypted client secret). RLS-scoped
 *   like every other tenant table.
 */
export class AddAuthMfaAndSso1784390000000 implements MigrationInterface {
  name = 'AddAuthMfaAndSso1784390000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN totp_secret_encrypted bytea,
        ADD COLUMN totp_enabled boolean NOT NULL DEFAULT false;
    `);

    await queryRunner.query(`
      CREATE TABLE tenant_sso_configs (
        tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        provider text NOT NULL DEFAULT 'oidc',
        issuer text NOT NULL,
        client_id text NOT NULL,
        client_secret_encrypted bytea NOT NULL,
        authorization_endpoint text NOT NULL,
        token_endpoint text NOT NULL,
        userinfo_endpoint text NOT NULL,
        default_role text NOT NULL DEFAULT 'agent',
        is_enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_sso_configs TO app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE tenant_sso_configs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE tenant_sso_configs FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON tenant_sso_configs
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON tenant_sso_configs;
      ALTER TABLE tenant_sso_configs NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE tenant_sso_configs DISABLE ROW LEVEL SECURITY;
    `);
    await queryRunner.query(
      `REVOKE ALL PRIVILEGES ON tenant_sso_configs FROM app_user;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS tenant_sso_configs;`);
    await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS totp_secret_encrypted,
        DROP COLUMN IF EXISTS totp_enabled;
    `);
  }
}
