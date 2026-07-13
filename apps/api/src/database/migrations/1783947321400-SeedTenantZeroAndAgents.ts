import { MigrationInterface, QueryRunner } from 'typeorm';

const TENANT_ZERO_SLUG = 'tekpro-internal';
const CLOUD_SUPPORT_GROUP_NAME = 'Cloud Support';

// Section 8 of the Module 1 doc names these six people and confirms they're
// seeded as Sprint 1 agents, but doesn't give real email addresses — these
// are placeholders (firstname.lastname@tekprocloud.com). Correct them with
// a follow-up UPDATE before relying on email intake to match a reply to the
// right agent.
const INITIAL_AGENTS = [
  { name: "Vincent D'Souza", email: 'vincent.dsouza@tekprocloud.com' },
  { name: 'Srinath Sreedharan', email: 'srinath.sreedharan@tekprocloud.com' },
  { name: 'Ruthvik M', email: 'ruthvik.m@tekprocloud.com' },
  { name: 'Sohel S', email: 'sohel.s@tekprocloud.com' },
  { name: 'Sparsh', email: 'sparsh@tekprocloud.com' },
  { name: 'Manoj K', email: 'manoj.k@tekprocloud.com' },
];

export class SeedTenantZeroAndAgents1783947321400 implements MigrationInterface {
  name = 'SeedTenantZeroAndAgents1783947321400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [tenant] = await queryRunner.query(
      `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
      ['Tekpro / MadVR (internal)', TENANT_ZERO_SLUG],
    );
    const tenantId = tenant.id;

    const [group] = await queryRunner.query(
      `INSERT INTO groups (tenant_id, name, description) VALUES ($1, $2, $3) RETURNING id`,
      [
        tenantId,
        CLOUD_SUPPORT_GROUP_NAME,
        'Tekpro cloud support, migrated from Freshdesk',
      ],
    );
    const groupId = group.id;

    for (const agent of INITIAL_AGENTS) {
      const [user] = await queryRunner.query(
        `INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES ($1, $2, $3, $4, 'agent') RETURNING id`,
        [tenantId, agent.email, agent.name, 'unset:auth-not-implemented-yet'],
      );
      await queryRunner.query(
        `INSERT INTO agents (tenant_id, user_id, group_ids, is_active) VALUES ($1, $2, $3, true)`,
        [tenantId, user.id, [groupId]],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [tenant] = await queryRunner.query(
      `SELECT id FROM tenants WHERE slug = $1`,
      [TENANT_ZERO_SLUG],
    );
    if (!tenant) return;

    await queryRunner.query(`DELETE FROM agents WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await queryRunner.query(
      `DELETE FROM users WHERE tenant_id = $1 AND email = ANY($2)`,
      [tenant.id, INITIAL_AGENTS.map((a) => a.email)],
    );
    await queryRunner.query(
      `DELETE FROM groups WHERE tenant_id = $1 AND name = $2`,
      [tenant.id, CLOUD_SUPPORT_GROUP_NAME],
    );
    await queryRunner.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
  }
}
