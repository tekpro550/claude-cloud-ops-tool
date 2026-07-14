import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlatformToTickets1784010000000 implements MigrationInterface {
  name = 'AddPlatformToTickets1784010000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE ticket_platform_enum AS ENUM ('aws', 'azure', 'alibaba_cloud', 'microsoft_365', 'tittu_marketing_platform', 'other');
    `);
    await queryRunner.query(`
      ALTER TABLE tickets ADD COLUMN platform ticket_platform_enum;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tickets DROP COLUMN IF EXISTS platform;
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS ticket_platform_enum;
    `);
  }
}
