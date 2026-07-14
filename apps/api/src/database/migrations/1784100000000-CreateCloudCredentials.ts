import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Module 2 (Monitoring) Sprint 4 — see
 * docs/Cloud-Ops-Tool-Module2-Monitoring-Scope.md. `config` holds
 * provider-specific credentials (AWS access key/secret/region; Azure
 * subscription/tenant/client id+secret) as plain jsonb, the same way every
 * other secret in this codebase (INTERNAL_API_KEY, JWT_SECRET, DB
 * passwords) is a plain configured value rather than field-level encrypted
 * -- there's no secrets-manager integration yet anywhere in the platform.
 * Real deployments should treat this table like any other credential store
 * and restrict database access accordingly; encrypting it at rest is future
 * work, not a Sprint 4 regression.
 */
export class CreateCloudCredentials1784100000000 implements MigrationInterface {
  name = 'CreateCloudCredentials1784100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE cloud_provider_enum AS ENUM ('aws', 'azure');

      CREATE TABLE cloud_credentials (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        provider cloud_provider_enum NOT NULL,
        label text NOT NULL,
        config jsonb NOT NULL,
        is_enabled boolean NOT NULL DEFAULT true,
        last_polled_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_cloud_credentials_tenant_id ON cloud_credentials(tenant_id);
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON cloud_credentials TO app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE cloud_credentials ENABLE ROW LEVEL SECURITY;
      ALTER TABLE cloud_credentials FORCE ROW LEVEL SECURITY;

      CREATE POLICY tenant_isolation ON cloud_credentials
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON cloud_credentials;
      ALTER TABLE cloud_credentials NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE cloud_credentials DISABLE ROW LEVEL SECURITY;
    `);

    await queryRunner.query(`REVOKE ALL PRIVILEGES ON cloud_credentials FROM app_user;`);

    await queryRunner.query(`
      DROP TABLE IF EXISTS cloud_credentials;
      DROP TYPE IF EXISTS cloud_provider_enum;
    `);
  }
}
