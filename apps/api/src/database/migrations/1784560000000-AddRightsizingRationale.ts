import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rightsizing AI rationale: adds a human-readable AI explanation column to
 * rightsizing recommendations, generated after each sweep upsert.
 */
export class AddRightsizingRationale1784560000000 implements MigrationInterface {
  name = 'AddRightsizingRationale1784560000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE rightsizing_recommendations
        ADD COLUMN IF NOT EXISTS ai_rationale text,
        ADD COLUMN IF NOT EXISTS ai_rationale_model text;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE rightsizing_recommendations
        DROP COLUMN IF EXISTS ai_rationale,
        DROP COLUMN IF EXISTS ai_rationale_model;
    `);
  }
}
