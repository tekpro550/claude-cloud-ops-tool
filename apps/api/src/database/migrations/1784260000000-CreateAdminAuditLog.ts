import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Admin audit log (Security review gap: config changes had no who/what/when
 * trail). One append-only row per admin/config mutation -- who did it
 * (actor_user_id + a denormalized actor_label so the trail survives a user
 * rename/delete), what changed (action + entity_type/entity_id + a
 * human-readable summary + a details jsonb), and when. Lives in the Platform
 * boundary, its documented home. app_user gets SELECT/INSERT only -- audit
 * rows are never updated or deleted through the app.
 */
export class CreateAdminAuditLog1784260000000 implements MigrationInterface {
  name = 'CreateAdminAuditLog1784260000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE admin_audit_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        actor_label text,
        action text NOT NULL,
        entity_type text NOT NULL,
        entity_id text,
        summary text NOT NULL,
        details jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_admin_audit_log_tenant_created
        ON admin_audit_log (tenant_id, created_at DESC);
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT ON admin_audit_log TO app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
      ALTER TABLE admin_audit_log FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON admin_audit_log
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON admin_audit_log;
      ALTER TABLE admin_audit_log NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE admin_audit_log DISABLE ROW LEVEL SECURITY;
    `);
    await queryRunner.query(
      `REVOKE ALL PRIVILEGES ON admin_audit_log FROM app_user;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS admin_audit_log;`);
  }
}
