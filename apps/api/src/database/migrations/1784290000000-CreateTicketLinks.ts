import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Linked tickets (Freshdesk parity: "related" tickets + parent/tracker
 * relationships). A directed edge from_ticket_id -> to_ticket_id with a type:
 *  - 'related'   : symmetric "see also" link
 *  - 'parent_of' : from is the tracker/parent, to is a child
 * A child reads its parent by finding the parent_of edge pointing at it.
 * Unique per (from, to, type); self-links are rejected in the service.
 */
export class CreateTicketLinks1784290000000 implements MigrationInterface {
  name = 'CreateTicketLinks1784290000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE ticket_link_type_enum AS ENUM ('related', 'parent_of');

      CREATE TABLE ticket_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        from_ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        to_ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        link_type ticket_link_type_enum NOT NULL DEFAULT 'related',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX idx_ticket_links_unique
        ON ticket_links (from_ticket_id, to_ticket_id, link_type);
      CREATE INDEX idx_ticket_links_to ON ticket_links (to_ticket_id);
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, DELETE ON ticket_links TO app_user;`,
    );

    await queryRunner.query(`
      ALTER TABLE ticket_links ENABLE ROW LEVEL SECURITY;
      ALTER TABLE ticket_links FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON ticket_links
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP POLICY IF EXISTS tenant_isolation ON ticket_links;
      ALTER TABLE ticket_links NO FORCE ROW LEVEL SECURITY;
      ALTER TABLE ticket_links DISABLE ROW LEVEL SECURITY;
    `);
    await queryRunner.query(
      `REVOKE ALL PRIVILEGES ON ticket_links FROM app_user;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS ticket_links;`);
    await queryRunner.query(`DROP TYPE IF EXISTS ticket_link_type_enum;`);
  }
}
