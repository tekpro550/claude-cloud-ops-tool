import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * KB article mining: stores AI-drafted knowledge-base articles generated from
 * clusters of resolved tickets with similar subjects.
 */
export class CreateKbArticles1784570000000 implements MigrationInterface {
  name = 'CreateKbArticles1784570000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE kb_articles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title text NOT NULL,
        body_md text NOT NULL,
        status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
        source_ticket_ids uuid[] NOT NULL DEFAULT '{}',
        tags text[] NOT NULL DEFAULT '{}',
        created_by uuid REFERENCES agents(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE kb_articles ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON kb_articles
        USING (tenant_id = current_setting('app.current_tenant')::uuid);
    `);
    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON kb_articles TO app_user;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS kb_articles;`);
  }
}
