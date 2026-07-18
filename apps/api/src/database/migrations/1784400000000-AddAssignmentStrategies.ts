import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Auto-assignment: a group can route new tickets to an agent automatically
 * instead of leaving them unassigned for a human to triage. Three strategies
 * beyond the default 'manual' (no auto-assign):
 *  - round_robin: cycles through the group's active agents in id order,
 *    remembering position in group_assignment_cursor.
 *  - load_based: picks the active agent with the fewest open tickets,
 *    optionally capped by max_open_tickets_per_agent.
 *  - skill_based: narrows to agents with a matching agent_skills row, then
 *    applies load-based tie-breaking among them.
 */
export class AddAssignmentStrategies1784400000000 implements MigrationInterface {
  name = 'AddAssignmentStrategies1784400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE groups
        ADD COLUMN assignment_strategy text NOT NULL DEFAULT 'manual'
          CHECK (assignment_strategy IN ('manual', 'round_robin', 'load_based', 'skill_based')),
        ADD COLUMN max_open_tickets_per_agent int;
    `);

    await queryRunner.query(
      `ALTER TABLE tickets ADD COLUMN required_skill text;`,
    );

    await queryRunner.query(`
      CREATE TABLE agent_skills (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        skill text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, agent_id, skill)
      );
      CREATE INDEX idx_agent_skills_tenant_agent ON agent_skills (tenant_id, agent_id);
      CREATE INDEX idx_agent_skills_tenant_skill ON agent_skills (tenant_id, skill);
    `);

    await queryRunner.query(`
      CREATE TABLE group_assignment_cursor (
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
        last_agent_id uuid,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (tenant_id, group_id)
      );
    `);

    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON agent_skills, group_assignment_cursor TO app_user;`,
    );

    for (const table of ['agent_skills', 'group_assignment_cursor']) {
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
    for (const table of ['agent_skills', 'group_assignment_cursor']) {
      await queryRunner.query(`
        DROP POLICY IF EXISTS tenant_isolation ON ${table};
        ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY;
        ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;
      `);
      await queryRunner.query(
        `REVOKE ALL PRIVILEGES ON ${table} FROM app_user;`,
      );
    }
    await queryRunner.query(`DROP TABLE IF EXISTS group_assignment_cursor;`);
    await queryRunner.query(`DROP TABLE IF EXISTS agent_skills;`);
    await queryRunner.query(
      `ALTER TABLE tickets DROP COLUMN IF EXISTS required_skill;`,
    );
    await queryRunner.query(`
      ALTER TABLE groups
        DROP COLUMN IF EXISTS assignment_strategy,
        DROP COLUMN IF EXISTS max_open_tickets_per_agent;
    `);
  }
}
