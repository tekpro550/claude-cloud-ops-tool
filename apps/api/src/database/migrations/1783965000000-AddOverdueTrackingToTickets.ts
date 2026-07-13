import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOverdueTrackingToTickets1783965000000 implements MigrationInterface {
  name = 'AddOverdueTrackingToTickets1783965000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tickets
        ADD COLUMN first_response_overdue_notified_at timestamptz,
        ADD COLUMN resolution_overdue_notified_at timestamptz;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tickets
        DROP COLUMN IF EXISTS resolution_overdue_notified_at,
        DROP COLUMN IF EXISTS first_response_overdue_notified_at;
    `);
  }
}
