import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cost spike narratives: cached AI-generated explanations of cost anomalies.
 * Input is hashed (sha256 of anomaly IDs + forecast) so the same anomaly set
 * returns the cached narrative rather than re-calling the AI on every view.
 */
export class CreateCostNarratives1784520000000 implements MigrationInterface {
  name = 'CreateCostNarratives1784520000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE cost_narratives (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        input_hash text NOT NULL,
        narrative text NOT NULL,
        model text,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(tenant_id, input_hash)
      );
      ALTER TABLE cost_narratives ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON cost_narratives
        USING (tenant_id = current_setting('app.current_tenant')::uuid);
    `);
    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON cost_narratives TO app_user;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS cost_narratives;`);
  }
}
