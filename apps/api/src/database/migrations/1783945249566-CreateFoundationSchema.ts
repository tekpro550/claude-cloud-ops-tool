import { MigrationInterface, QueryRunner } from "typeorm";

const RLS_TABLES = ["users", "resources", "events", "notifications"];

export class CreateFoundationSchema1783945249566 implements MigrationInterface {
  name = "CreateFoundationSchema1783945249566";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE plan_tier_enum AS ENUM ('internal', 'starter', 'growth', 'scale');

      CREATE TABLE tenants (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        slug text NOT NULL UNIQUE,
        plan_tier plan_tier_enum NOT NULL DEFAULT 'internal',
        financial_year_start_month int NOT NULL DEFAULT 4,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TYPE user_role_enum AS ENUM ('admin', 'agent', 'viewer');

      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        email text NOT NULL,
        name text NOT NULL,
        password_hash text NOT NULL,
        role user_role_enum NOT NULL DEFAULT 'agent',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, email)
      );
      CREATE INDEX idx_users_tenant_id ON users(tenant_id);

      CREATE TYPE resource_type_enum AS ENUM ('server', 'cloud_account', 'service', 'website', 'database', 'other');

      CREATE TABLE resources (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        resource_type resource_type_enum NOT NULL,
        group_name text,
        external_ref jsonb NOT NULL DEFAULT '{}',
        tags jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_resources_tenant_id ON resources(tenant_id);

      CREATE TABLE events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        event_type text NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_events_tenant_id ON events(tenant_id);
      CREATE INDEX idx_events_event_type ON events(event_type);

      CREATE TYPE notification_channel_enum AS ENUM ('email', 'whatsapp', 'voice', 'in_app');
      CREATE TYPE notification_status_enum AS ENUM ('queued', 'sent', 'failed');

      CREATE TABLE notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        channel notification_channel_enum NOT NULL,
        recipient text NOT NULL,
        template_name text NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}',
        status notification_status_enum NOT NULL DEFAULT 'queued',
        created_at timestamptz NOT NULL DEFAULT now(),
        sent_at timestamptz
      );
      CREATE INDEX idx_notifications_tenant_id ON notifications(tenant_id);
    `);

    // Runtime role: the NestJS app connects as this role, never as the migrator/owner
    // role above. RLS policies below apply to it, which is what makes tenant isolation
    // a database-layer guarantee rather than something the app has to remember to check.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
          CREATE ROLE app_user LOGIN;
        END IF;
      END
      $$;
    `);
    // ALTER ROLE ... PASSWORD is DDL and doesn't accept bound $1 parameters,
    // so dollar-quote the value instead of interpolating it as a plain
    // string literal (avoids breaking on an embedded quote character).
    const appPassword = process.env.DB_APP_PASSWORD ?? "app_user_dev_password";
    await queryRunner.query(`ALTER ROLE app_user PASSWORD $pw$${appPassword}$pw$`);
    await queryRunner.query(`
      DO $$
      BEGIN
        EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_user', current_database());
      END
      $$;

      GRANT USAGE ON SCHEMA public TO app_user;
      GRANT SELECT ON tenants TO app_user;
      GRANT SELECT, INSERT, UPDATE, DELETE ON users, resources, events, notifications TO app_user;
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
      REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM app_user;
      REVOKE USAGE ON SCHEMA public FROM app_user;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM app_user', current_database());
      END
      $$;
    `);
    await queryRunner.query(`DROP ROLE IF EXISTS app_user;`);

    await queryRunner.query(`
      DROP TABLE IF EXISTS notifications;
      DROP TYPE IF EXISTS notification_status_enum;
      DROP TYPE IF EXISTS notification_channel_enum;

      DROP TABLE IF EXISTS events;

      DROP TABLE IF EXISTS resources;
      DROP TYPE IF EXISTS resource_type_enum;

      DROP TABLE IF EXISTS users;
      DROP TYPE IF EXISTS user_role_enum;

      DROP TABLE IF EXISTS tenants;
      DROP TYPE IF EXISTS plan_tier_enum;
    `);
  }
}
