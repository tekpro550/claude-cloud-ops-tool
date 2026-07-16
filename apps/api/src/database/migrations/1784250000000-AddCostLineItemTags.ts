import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cost allocation tags (CloudSpend parity gap: "show me spend broken down by
 * team/environment/project"). Cloud bills carry key/value cost-allocation
 * tags per line item; we store them as a jsonb map on cost_line_items so the
 * allocation view can GROUP BY any tag key. A GIN index keeps
 * "tags ? 'team'" key-existence filters and value lookups fast.
 */
export class AddCostLineItemTags1784250000000 implements MigrationInterface {
  name = 'AddCostLineItemTags1784250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE cost_line_items ADD COLUMN tags jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_cost_line_items_tags ON cost_line_items USING gin (tags)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_cost_line_items_tags`);
    await queryRunner.query(`ALTER TABLE cost_line_items DROP COLUMN tags`);
  }
}
