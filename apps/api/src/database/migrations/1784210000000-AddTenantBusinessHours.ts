import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-tenant business-hours window, so SLA policies flagged
 * business_hours_only actually compute due dates against working time
 * instead of the flat 24/7 math calculate-due-dates.ts used to fall back to.
 * The review flagged this as a correctness gap: the UI promised business
 * hours the engine ignored.
 *
 * Stored as plain columns on `tenants` (same home as the cost settings
 * financial_year_start_month/cost_rate_display), defaulting to Mon-Fri
 * 09:00-17:00 UTC.
 */
export class AddTenantBusinessHours1784210000000 implements MigrationInterface {
  name = 'AddTenantBusinessHours1784210000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
        ADD COLUMN business_hours_start_minute integer NOT NULL DEFAULT 540,
        ADD COLUMN business_hours_end_minute integer NOT NULL DEFAULT 1020,
        ADD COLUMN business_hours_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
        ADD COLUMN business_hours_timezone text NOT NULL DEFAULT 'UTC';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenants
        DROP COLUMN business_hours_start_minute,
        DROP COLUMN business_hours_end_minute,
        DROP COLUMN business_hours_days,
        DROP COLUMN business_hours_timezone;
    `);
  }
}
