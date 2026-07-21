import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Ask" assistant: stores conversation sessions and messages for the unified
 * cross-module natural-language assistant. RLS-scoped per tenant.
 */
export class CreateAskSessions1784580000000 implements MigrationInterface {
  name = 'CreateAskSessions1784580000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ask_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE ask_sessions ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON ask_sessions
        USING (tenant_id = current_setting('app.current_tenant')::uuid);

      CREATE TABLE ask_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        session_id uuid NOT NULL REFERENCES ask_sessions(id) ON DELETE CASCADE,
        role text NOT NULL CHECK (role IN ('user','assistant')),
        content text NOT NULL,
        tool_calls jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE ask_messages ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON ask_messages
        USING (tenant_id = current_setting('app.current_tenant')::uuid);
    `);
    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ask_sessions, ask_messages TO app_user;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS ask_messages;
      DROP TABLE IF EXISTS ask_sessions;
    `);
  }
}
