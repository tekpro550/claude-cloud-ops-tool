import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Similar ticket detection: adds pg_trgm extension + GIN index on ticket
 * subjects for fast trigram similarity search, and a table to store
 * AI-ranked similar ticket suggestions.
 */
export class AddTicketSimilarity1784540000000 implements MigrationInterface {
  name = 'AddTicketSimilarity1784540000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      CREATE INDEX IF NOT EXISTS idx_tickets_subject_trgm ON tickets USING GIN (subject gin_trgm_ops);

      CREATE TABLE ticket_similar_suggestions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        similar_ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        score numeric(5,4) NOT NULL,
        ai_ranked boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(ticket_id, similar_ticket_id)
      );
      ALTER TABLE ticket_similar_suggestions ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON ticket_similar_suggestions
        USING (tenant_id = current_setting('app.current_tenant')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS ticket_similar_suggestions;
      DROP INDEX IF EXISTS idx_tickets_subject_trgm;
    `);
  }
}
