import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Multi-location probing. Each probe worker tags the checks it records with its
 * PROBE_LOCATION, so the same monitor can be checked from several regions
 * writing into one monitor_checks table. monitors.min_failing_locations is the
 * false-positive suppression knob: an alert only opens once at least that many
 * distinct locations are currently failing, so a single region's blip doesn't
 * page anyone. Default 1 preserves today's single-location behavior.
 */
export class AddMultiLocationProbing1784370000000 implements MigrationInterface {
  name = 'AddMultiLocationProbing1784370000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE monitor_checks ADD COLUMN location text NOT NULL DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE monitors ADD COLUMN min_failing_locations int NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_monitor_checks_monitor_location
         ON monitor_checks (monitor_id, location, checked_at DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_monitor_checks_monitor_location`,
    );
    await queryRunner.query(
      `ALTER TABLE monitors DROP COLUMN min_failing_locations`,
    );
    await queryRunner.query(`ALTER TABLE monitor_checks DROP COLUMN location`);
  }
}
