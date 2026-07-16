import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Free-form ticket tags (High-severity Freshdesk gap: tags drive filtering,
 * automation, and reporting). Stored as a text[] on tickets -- the same
 * free-form, reusable-across-tickets shape Freshdesk tags have -- with a GIN
 * index so "tickets with tag X" filters stay fast.
 */
export class AddTicketTags1784240000000 implements MigrationInterface {
  name = 'AddTicketTags1784240000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tickets ADD COLUMN tags text[] NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_tickets_tags ON tickets USING gin (tags)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_tickets_tags`);
    await queryRunner.query(`ALTER TABLE tickets DROP COLUMN tags`);
  }
}
