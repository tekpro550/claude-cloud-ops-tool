import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Native chat: a live conversation channel. A visitor (optionally a known
 * contact) opens a chat_session; messages flow both ways in chat_messages and
 * agents pick sessions up from a console. Both tables are RLS-scoped like the
 * rest of the tenant data. Real-time delivery is polling today; a WebSocket
 * transport can layer on later without changing this schema.
 */
export class CreateChat1784380000000 implements MigrationInterface {
  name = 'CreateChat1784380000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE chat_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
        visitor_name text NOT NULL,
        status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
        assigned_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_message_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_chat_sessions_tenant_status
        ON chat_sessions (tenant_id, status, last_message_at DESC);

      CREATE TABLE chat_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        chat_session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        author_type text NOT NULL CHECK (author_type IN ('visitor', 'agent', 'system')),
        author_id uuid,
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_chat_messages_session
        ON chat_messages (chat_session_id, created_at);
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON chat_sessions, chat_messages TO app_user;`,
    );

    for (const table of ['chat_sessions', 'chat_messages']) {
      await queryRunner.query(`
        ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON ${table}
          USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['chat_messages', 'chat_sessions']) {
      await queryRunner.query(`
        DROP POLICY IF EXISTS tenant_isolation ON ${table};
        ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY;
        ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;
      `);
      await queryRunner.query(
        `REVOKE ALL PRIVILEGES ON ${table} FROM app_user;`,
      );
    }
    await queryRunner.query(`DROP TABLE IF EXISTS chat_messages;`);
    await queryRunner.query(`DROP TABLE IF EXISTS chat_sessions;`);
  }
}
