import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Solutions (knowledge base articles) -- referenced by the Module 1 doc's
 * /portal/solutions endpoint and the search scope, but never actually given
 * a schema in the doc's own data model section. Minimal shape: title/body,
 * published or not (drafts stay agent-only, published is what the portal's
 * public knowledge base and global search surface).
 */
export class CreateSolutions1784050000000 implements MigrationInterface {
  name = 'CreateSolutions1784050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE solutions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title text NOT NULL,
        body text NOT NULL,
        is_published boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_solutions_tenant_id ON solutions(tenant_id);

      GRANT SELECT, INSERT, UPDATE, DELETE ON solutions TO app_user;

      ALTER TABLE solutions ENABLE ROW LEVEL SECURITY;
      ALTER TABLE solutions FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON solutions
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON solutions;
      DROP TABLE IF EXISTS solutions;
    `);
  }
}
