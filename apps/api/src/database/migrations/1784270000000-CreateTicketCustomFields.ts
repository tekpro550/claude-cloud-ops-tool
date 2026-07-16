import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Custom ticket fields (core Freshdesk parity gap -- every plan has them).
 * Admins define fields (ticket_custom_field_defs); each ticket carries a
 * jsonb map of key -> value in tickets.custom_fields. Values are validated
 * against the active defs in TicketsService on create/update; storing them as
 * one jsonb column (rather than a wide, ever-changing table) keeps the schema
 * stable as fields come and go, the same shape scenarios/automation configs
 * already use.
 */
export class CreateTicketCustomFields1784270000000
  implements MigrationInterface
{
  name = 'CreateTicketCustomFields1784270000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE ticket_custom_field_type_enum AS ENUM
        ('text', 'number', 'dropdown', 'checkbox', 'date');

      CREATE TABLE ticket_custom_field_defs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        key text NOT NULL,
        label text NOT NULL,
        field_type ticket_custom_field_type_enum NOT NULL,
        options text[] NOT NULL DEFAULT '{}',
        is_required boolean NOT NULL DEFAULT false,
        is_active boolean NOT NULL DEFAULT true,
        position int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX idx_ticket_custom_field_defs_key
        ON ticket_custom_field_defs (tenant_id, key);

      ALTER TABLE tickets ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}';
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ticket_custom_field_defs TO app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE ticket_custom_field_defs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ticket_custom_field_defs FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON ticket_custom_field_defs
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tickets DROP COLUMN custom_fields;`);
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON ticket_custom_field_defs;
      ALTER TABLE ticket_custom_field_defs NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE ticket_custom_field_defs DISABLE ROW LEVEL SECURITY;
    `);
    await queryRunner.query(
      `REVOKE ALL PRIVILEGES ON ticket_custom_field_defs FROM app_user;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS ticket_custom_field_defs;`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS ticket_custom_field_type_enum;`,
    );
  }
}
