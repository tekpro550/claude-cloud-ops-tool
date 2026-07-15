import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Feeds the tenant-wide activity feed (dashboard.service.ts's activity()) --
 * without this, a property-change row has no way to say which agent made
 * the change, only what changed. Nullable: rows written before this
 * migration, and any future system-initiated change (automation rules),
 * legitimately have no agent to attribute.
 */
export class AddTicketActivityActor1784120000000 implements MigrationInterface {
  name = 'AddTicketActivityActor1784120000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ticket_activities
        ADD COLUMN actor_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ticket_activities DROP COLUMN actor_agent_id;
    `);
  }
}
