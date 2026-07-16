import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ticket watchers/followers (Freshdesk parity): agents who aren't the assignee
 * but want to be notified of activity on a ticket. One row per (ticket, agent);
 * unique so a double-watch is a no-op. RLS-scoped like the rest of ticketing.
 */
export class CreateTicketWatchers1784300000000 implements MigrationInterface {
  name = 'CreateTicketWatchers1784300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ticket_watchers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX idx_ticket_watchers_unique
        ON ticket_watchers (ticket_id, agent_id);
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, DELETE ON ticket_watchers TO app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE ticket_watchers ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ticket_watchers FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON ticket_watchers
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON ticket_watchers;
      ALTER TABLE ticket_watchers NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE ticket_watchers DISABLE ROW LEVEL SECURITY;
    `);
    await queryRunner.query(
      `REVOKE ALL PRIVILEGES ON ticket_watchers FROM app_user;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS ticket_watchers;`);
  }
}
