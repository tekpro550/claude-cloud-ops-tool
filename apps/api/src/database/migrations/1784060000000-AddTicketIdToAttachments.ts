import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ticket_attachments.ticket_message_id was NOT NULL, which forced a
 * ticket-level attachment (e.g. one added to the original description, with
 * no specific reply/note it belongs to) to be attributed to whichever
 * message happened to be handy -- the Freshdesk migration was doing exactly
 * that, tagging description attachments onto the first imported conversation
 * even though they were never actually part of that message. Adding a real
 * ticket_id column (always present) and making ticket_message_id nullable
 * lets a ticket-level attachment exist honestly, without a message to lie
 * about being attached to.
 */
export class AddTicketIdToAttachments1784060000000 implements MigrationInterface {
  name = 'AddTicketIdToAttachments1784060000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ticket_attachments ADD COLUMN ticket_id uuid REFERENCES tickets(id) ON DELETE CASCADE;

      UPDATE ticket_attachments a
      SET ticket_id = m.ticket_id
      FROM ticket_messages m
      WHERE a.ticket_message_id = m.id;

      ALTER TABLE ticket_attachments ALTER COLUMN ticket_id SET NOT NULL;
      ALTER TABLE ticket_attachments ALTER COLUMN ticket_message_id DROP NOT NULL;

      CREATE INDEX idx_ticket_attachments_ticket_id ON ticket_attachments(ticket_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_ticket_attachments_ticket_id;
      ALTER TABLE ticket_attachments ALTER COLUMN ticket_message_id SET NOT NULL;
      ALTER TABLE ticket_attachments DROP COLUMN ticket_id;
    `);
  }
}
