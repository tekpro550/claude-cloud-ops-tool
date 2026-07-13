import { MigrationInterface, QueryRunner } from 'typeorm';

const RLS_TABLES = [
  'groups',
  'agents',
  'companies',
  'contacts',
  'ticket_types',
  'tickets',
  'ticket_messages',
  'ticket_number_counters',
];

export class CreateTicketingSchema1783947249262 implements MigrationInterface {
  name = 'CreateTicketingSchema1783947249262';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE groups (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        description text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_groups_tenant_id ON groups(tenant_id);

      CREATE TABLE agents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        group_ids uuid[] NOT NULL DEFAULT '{}',
        is_active boolean NOT NULL DEFAULT true,
        UNIQUE (tenant_id, user_id)
      );
      CREATE INDEX idx_agents_tenant_id ON agents(tenant_id);

      CREATE TABLE companies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        domain text
      );
      CREATE INDEX idx_companies_tenant_id ON companies(tenant_id);

      CREATE TABLE contacts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
        name text NOT NULL,
        email text,
        phone text,
        social_handles jsonb NOT NULL DEFAULT '{}'
      );
      CREATE INDEX idx_contacts_tenant_id ON contacts(tenant_id);
      CREATE INDEX idx_contacts_company_id ON contacts(company_id);
      CREATE INDEX idx_contacts_email ON contacts(tenant_id, email);

      CREATE TABLE ticket_types (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        default_group_id uuid REFERENCES groups(id) ON DELETE SET NULL,
        -- FK to sla_policies added in Sprint 2, once that table exists.
        default_sla_policy_id uuid
      );
      CREATE INDEX idx_ticket_types_tenant_id ON ticket_types(tenant_id);

      CREATE TYPE ticket_status_enum AS ENUM ('new', 'open', 'pending', 'resolved', 'closed');
      CREATE TYPE ticket_priority_enum AS ENUM ('low', 'medium', 'high', 'urgent');
      CREATE TYPE ticket_source_enum AS ENUM ('email', 'web_form', 'whatsapp', 'chat', 'api', 'alert');

      CREATE TABLE tickets (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        ticket_number int NOT NULL,
        legacy_ticket_number int,
        subject text NOT NULL,
        contact_id uuid NOT NULL REFERENCES contacts(id),
        ticket_type_id uuid REFERENCES ticket_types(id),
        status ticket_status_enum NOT NULL DEFAULT 'new',
        priority ticket_priority_enum NOT NULL DEFAULT 'medium',
        group_id uuid REFERENCES groups(id),
        agent_id uuid REFERENCES agents(id),
        resource_id uuid REFERENCES resources(id),
        -- FK to sla_policies added in Sprint 2, once that table exists.
        -- SLA due-date columns stay unpopulated until Sprint 2's SLA
        -- calculation job exists; the columns are here now so tickets
        -- doesn't need a later ALTER TABLE to add them.
        sla_policy_id uuid,
        first_response_due_at timestamptz,
        first_response_at timestamptz,
        resolution_due_at timestamptz,
        resolved_at timestamptz,
        source ticket_source_enum NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, ticket_number)
      );
      CREATE INDEX idx_tickets_tenant_id ON tickets(tenant_id);
      CREATE INDEX idx_tickets_status ON tickets(tenant_id, status);
      CREATE INDEX idx_tickets_contact_id ON tickets(contact_id);
      CREATE INDEX idx_tickets_agent_id ON tickets(agent_id);

      CREATE TYPE ticket_message_type_enum AS ENUM ('reply', 'note', 'forward');
      CREATE TYPE ticket_message_author_type_enum AS ENUM ('agent', 'contact', 'system');

      CREATE TABLE ticket_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        type ticket_message_type_enum NOT NULL,
        author_type ticket_message_author_type_enum NOT NULL,
        author_id uuid,
        body text NOT NULL,
        cc text[] NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_ticket_messages_tenant_id ON ticket_messages(tenant_id);
      CREATE INDEX idx_ticket_messages_ticket_id ON ticket_messages(ticket_id);

      -- Backs "ticket numbering: sequential per tenant, not globally"
      -- (section 5). One row per tenant; ticket creation atomically
      -- increments next_value and uses the pre-increment value, so
      -- concurrent creates never collide without needing an explicit lock.
      CREATE TABLE ticket_number_counters (
        tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        next_value int NOT NULL DEFAULT 1
      );
    `);

    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON
        groups, agents, companies, contacts, ticket_types, tickets, ticket_messages, ticket_number_counters
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
        groups, agents, companies, contacts, ticket_types, tickets, ticket_messages, ticket_number_counters
        FROM app_user;
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS ticket_number_counters;

      DROP TABLE IF EXISTS ticket_messages;
      DROP TYPE IF EXISTS ticket_message_author_type_enum;
      DROP TYPE IF EXISTS ticket_message_type_enum;

      DROP TABLE IF EXISTS tickets;
      DROP TYPE IF EXISTS ticket_source_enum;
      DROP TYPE IF EXISTS ticket_priority_enum;
      DROP TYPE IF EXISTS ticket_status_enum;

      DROP TABLE IF EXISTS ticket_types;
      DROP TABLE IF EXISTS contacts;
      DROP TABLE IF EXISTS companies;
      DROP TABLE IF EXISTS agents;
      DROP TABLE IF EXISTS groups;
    `);
  }
}
