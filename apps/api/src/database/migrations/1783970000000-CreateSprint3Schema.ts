import { MigrationInterface, QueryRunner } from 'typeorm';

const RLS_TABLES = [
  'automation_rules',
  'canned_responses',
  'ticket_todos',
  'ticket_time_logs',
];

export class CreateSprint3Schema1783970000000 implements MigrationInterface {
  name = 'CreateSprint3Schema1783970000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE automation_trigger_enum AS ENUM ('ticket_created', 'ticket_updated');

      CREATE TABLE automation_rules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        trigger automation_trigger_enum NOT NULL,
        position int NOT NULL DEFAULT 0,
        is_active boolean NOT NULL DEFAULT true,
        conditions jsonb NOT NULL DEFAULT '[]',
        actions jsonb NOT NULL DEFAULT '[]',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_automation_rules_tenant_id ON automation_rules(tenant_id);
      CREATE INDEX idx_automation_rules_trigger ON automation_rules(tenant_id, trigger);

      CREATE TABLE canned_responses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title text NOT NULL,
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_canned_responses_tenant_id ON canned_responses(tenant_id);

      CREATE TABLE ticket_todos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        body text NOT NULL,
        is_done boolean NOT NULL DEFAULT false,
        done_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_ticket_todos_tenant_id ON ticket_todos(tenant_id);
      CREATE INDEX idx_ticket_todos_ticket_id ON ticket_todos(ticket_id);

      CREATE TABLE ticket_time_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        agent_id uuid REFERENCES agents(id),
        minutes int NOT NULL,
        note text,
        logged_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_ticket_time_logs_tenant_id ON ticket_time_logs(tenant_id);
      CREATE INDEX idx_ticket_time_logs_ticket_id ON ticket_time_logs(ticket_id);
    `);

    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON
        automation_rules, canned_responses, ticket_todos, ticket_time_logs
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
    for (const table of RLS_TABLES) {
      await queryRunner.query(`
        DROP POLICY IF EXISTS tenant_isolation ON ${table};
        ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY;
        ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;
      `);
    }

    await queryRunner.query(`
      REVOKE ALL PRIVILEGES ON
        automation_rules, canned_responses, ticket_todos, ticket_time_logs
        FROM app_user;
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS ticket_time_logs;
      DROP TABLE IF EXISTS ticket_todos;
      DROP TABLE IF EXISTS canned_responses;
      DROP TABLE IF EXISTS automation_rules;
      DROP TYPE IF EXISTS automation_trigger_enum;
    `);
  }
}
