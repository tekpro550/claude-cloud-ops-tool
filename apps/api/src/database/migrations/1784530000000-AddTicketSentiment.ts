import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ticket sentiment detection: adds AI-detected sentiment fields to tickets.
 * Sentiment is updated asynchronously after each inbound customer message.
 */
export class AddTicketSentiment1784530000000 implements MigrationInterface {
  name = 'AddTicketSentiment1784530000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tickets
        ADD COLUMN IF NOT EXISTS sentiment text CHECK (sentiment IN ('positive','neutral','negative','at_risk')),
        ADD COLUMN IF NOT EXISTS sentiment_score numeric(4,3),
        ADD COLUMN IF NOT EXISTS sentiment_updated_at timestamptz;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tickets
        DROP COLUMN IF EXISTS sentiment,
        DROP COLUMN IF EXISTS sentiment_score,
        DROP COLUMN IF EXISTS sentiment_updated_at;
    `);
  }
}
