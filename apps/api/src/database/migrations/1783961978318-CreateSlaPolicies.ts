import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSlaPolicies1783961978318 implements MigrationInterface {
  name = 'CreateSlaPolicies1783961978318';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE sla_policies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name text NOT NULL,
        first_response_target_minutes int NOT NULL,
        resolution_target_minutes int NOT NULL,
        business_hours_only boolean NOT NULL DEFAULT false,
        escalation_rules jsonb NOT NULL DEFAULT '{}'
      );
      CREATE INDEX idx_sla_policies_tenant_id ON sla_policies(tenant_id);

      -- These columns existed since Sprint 1.1 (CreateTicketingSchema) but
      -- had no FK, since sla_policies didn't exist yet. Adding it now that
      -- it does.
      ALTER TABLE ticket_types
        ADD CONSTRAINT fk_ticket_types_default_sla_policy
        FOREIGN KEY (default_sla_policy_id) REFERENCES sla_policies(id) ON DELETE SET NULL;

      ALTER TABLE tickets
        ADD CONSTRAINT fk_tickets_sla_policy
        FOREIGN KEY (sla_policy_id) REFERENCES sla_policies(id) ON DELETE SET NULL;
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON sla_policies TO app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE sla_policies ENABLE ROW LEVEL SECURITY;
      ALTER TABLE sla_policies FORCE ROW LEVEL SECURITY;

      CREATE POLICY tenant_isolation ON sla_policies
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON sla_policies;
      ALTER TABLE sla_policies NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE sla_policies DISABLE ROW LEVEL SECURITY;
    `);

    await queryRunner.query(
      `REVOKE ALL PRIVILEGES ON sla_policies FROM app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE tickets DROP CONSTRAINT IF EXISTS fk_tickets_sla_policy;
      ALTER TABLE ticket_types DROP CONSTRAINT IF EXISTS fk_ticket_types_default_sla_policy;
      DROP TABLE IF EXISTS sla_policies;
    `);
  }
}
