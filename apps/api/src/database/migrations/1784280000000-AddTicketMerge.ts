import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ticket merge (core Freshdesk agent workflow: fold duplicates into one
 * primary). A merged source ticket points at its primary via merged_into_id
 * and is closed; its conversation is carried over to the primary. Nullable
 * self-FK, ON DELETE SET NULL so deleting a primary doesn't cascade-delete
 * the (already closed) sources.
 */
export class AddTicketMerge1784280000000 implements MigrationInterface {
  name = 'AddTicketMerge1784280000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tickets ADD COLUMN merged_into_id uuid REFERENCES tickets(id) ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_tickets_merged_into ON tickets(merged_into_id) WHERE merged_into_id IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_tickets_merged_into`);
    await queryRunner.query(
      `ALTER TABLE tickets DROP COLUMN merged_into_id`,
    );
  }
}
