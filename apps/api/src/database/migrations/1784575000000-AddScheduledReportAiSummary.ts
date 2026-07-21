import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Report AI executive summary: adds a flag to scheduled reports so an AI
 * narrative summary is prepended to the report output when enabled.
 */
export class AddScheduledReportAiSummary1784575000000 implements MigrationInterface {
  name = 'AddScheduledReportAiSummary1784575000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE scheduled_reports
        ADD COLUMN IF NOT EXISTS include_ai_summary boolean NOT NULL DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE scheduled_reports
        DROP COLUMN IF EXISTS include_ai_summary;
    `);
  }
}
