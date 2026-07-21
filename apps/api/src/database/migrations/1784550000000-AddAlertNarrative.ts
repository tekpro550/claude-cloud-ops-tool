import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Alert RCA narrative: AI-generated root cause analysis attached to each alert
 * when it fires. Stored on the alert row itself (not a separate table) since
 * one narrative per alert is the right cardinality.
 */
export class AddAlertNarrative1784550000000 implements MigrationInterface {
  name = 'AddAlertNarrative1784550000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE alerts
        ADD COLUMN IF NOT EXISTS narrative text,
        ADD COLUMN IF NOT EXISTS narrative_model text,
        ADD COLUMN IF NOT EXISTS narrative_generated_at timestamptz;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE alerts
        DROP COLUMN IF EXISTS narrative,
        DROP COLUMN IF EXISTS narrative_model,
        DROP COLUMN IF EXISTS narrative_generated_at;
    `);
  }
}
