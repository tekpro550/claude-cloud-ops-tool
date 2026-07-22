import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chat AI first-responder + KB portal deflection.
 *
 * - chat_messages gains an 'ai' author type so an AI reply is distinguishable
 *   from a human agent or a system notice (the frontend styles it as a bot).
 * - chat_sessions gains ai_enabled (default true): the AI holds a session
 *   until a human agent claims it (assigned_agent_id) or the tenant opts a
 *   session out. This column is the explicit off switch.
 * - pg_trgm GIN indexes on kb_articles.title/body_md so published-article
 *   search (portal deflection + chat context) is index-backed, not a scan.
 */
export class AddChatAiAndKbSearch1784600000000 implements MigrationInterface {
  name = 'AddChatAiAndKbSearch1784600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_author_type_check;
      ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_author_type_check
        CHECK (author_type IN ('visitor', 'agent', 'system', 'ai'));

      ALTER TABLE chat_sessions
        ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true;

      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      CREATE INDEX IF NOT EXISTS kb_articles_title_trgm
        ON kb_articles USING gin (title gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS kb_articles_body_trgm
        ON kb_articles USING gin (body_md gin_trgm_ops);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS kb_articles_body_trgm;
      DROP INDEX IF EXISTS kb_articles_title_trgm;
      ALTER TABLE chat_sessions DROP COLUMN IF EXISTS ai_enabled;
      ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_author_type_check;
      ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_author_type_check
        CHECK (author_type IN ('visitor', 'agent', 'system'));
    `);
  }
}
