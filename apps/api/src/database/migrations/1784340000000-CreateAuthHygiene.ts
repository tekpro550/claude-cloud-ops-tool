import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Auth hygiene: password reset tokens. Login rate-limiting and session
 * revocation ("log out everywhere", enforced when a password is reset) live in
 * Redis (auth-security.ts), not here -- this migration only adds the durable
 * reset-token store. Tokens are stored hashed (sha256), single-use, and
 * short-lived; the raw token only ever travels in the reset email.
 */
export class CreateAuthHygiene1784340000000 implements MigrationInterface {
  name = 'CreateAuthHygiene1784340000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE password_reset_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash text NOT NULL,
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_password_reset_tokens_hash ON password_reset_tokens (token_hash);
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE ON password_reset_tokens TO app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
      ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON password_reset_tokens
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON password_reset_tokens;
      ALTER TABLE password_reset_tokens NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE password_reset_tokens DISABLE ROW LEVEL SECURITY;
    `);
    await queryRunner.query(
      `REVOKE ALL PRIVILEGES ON password_reset_tokens FROM app_user;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS password_reset_tokens;`);
  }
}
