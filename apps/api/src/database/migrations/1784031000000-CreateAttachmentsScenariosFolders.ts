import { MigrationInterface, QueryRunner } from 'typeorm';

const RLS_TABLES = [
  'ticket_attachments',
  'scenarios',
  'canned_response_folders',
];

export class CreateAttachmentsScenariosFolders1784031000000 implements MigrationInterface {
  name = 'CreateAttachmentsScenariosFolders1784031000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ticket_attachments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        ticket_message_id uuid NOT NULL REFERENCES ticket_messages(id) ON DELETE CASCADE,
        file_name text NOT NULL,
        file_size_bytes bigint NOT NULL,
        storage_path text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_ticket_attachments_tenant_id ON ticket_attachments(tenant_id);
      CREATE INDEX idx_ticket_attachments_ticket_message_id ON ticket_attachments(ticket_message_id);

      CREATE TABLE scenarios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        agent_id uuid REFERENCES agents(id) ON DELETE CASCADE,
        name text NOT NULL,
        actions jsonb NOT NULL DEFAULT '[]',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_scenarios_tenant_id ON scenarios(tenant_id);

      CREATE TABLE canned_response_folders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        agent_id uuid REFERENCES agents(id) ON DELETE CASCADE,
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_canned_response_folders_tenant_id ON canned_response_folders(tenant_id);

      ALTER TABLE canned_responses ADD COLUMN folder_id uuid REFERENCES canned_response_folders(id) ON DELETE SET NULL;
    `);

    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON
        ticket_attachments, scenarios, canned_response_folders
        TO app_user;
    `);

    for (const table of RLS_TABLES) {
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
    await queryRunner.query(`
      ALTER TABLE canned_responses DROP COLUMN IF EXISTS folder_id;
      DROP TABLE IF EXISTS canned_response_folders;
      DROP TABLE IF EXISTS scenarios;
      DROP TABLE IF EXISTS ticket_attachments;
    `);
  }
}
