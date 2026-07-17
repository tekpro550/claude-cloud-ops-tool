import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Links a knowledge-base article back to the ticket it was auto-generated from,
 * so resolving a ticket can seed a draft article without creating duplicates on
 * re-resolve. The partial unique index enforces at most one auto-article per
 * source ticket; manually authored articles leave source_ticket_id NULL and are
 * unaffected.
 */
export class AddSolutionSourceTicket1784330000000 implements MigrationInterface {
  name = 'AddSolutionSourceTicket1784330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE solutions ADD COLUMN source_ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX idx_solutions_source_ticket
         ON solutions (source_ticket_id) WHERE source_ticket_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_solutions_source_ticket`);
    await queryRunner.query(
      `ALTER TABLE solutions DROP COLUMN source_ticket_id`,
    );
  }
}
