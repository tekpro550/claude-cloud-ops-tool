import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTicketActivities1784020000000 implements MigrationInterface {
  name = 'CreateTicketActivities1784020000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ticket_activities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        field text NOT NULL,
        old_value text,
        new_value text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_ticket_activities_tenant_id ON ticket_activities(tenant_id);
      CREATE INDEX idx_ticket_activities_ticket_id ON ticket_activities(ticket_id);
    `);

    await queryRunner.query(`
      GRANT SELECT, INSERT, UPDATE, DELETE ON ticket_activities TO app_user;
    `);

    await queryRunner.query(`
      ALTER TABLE ticket_activities ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ticket_activities FORCE ROW LEVEL SECURITY;

      CREATE POLICY tenant_isolation ON ticket_activities
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS ticket_activities;`);
  }
}
