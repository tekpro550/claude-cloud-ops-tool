import { MigrationInterface, QueryRunner } from "typeorm";

const TENANT_ZERO_SLUG = "tekpro-internal";

// Real addresses confirmed by the customer, replacing the
// firstname.lastname@tekprocloud.com placeholders from the Sprint 1.1 seed
// migration.
const EMAIL_CORRECTIONS = [
  { oldEmail: "vincent.dsouza@tekprocloud.com", newEmail: "vincent@tekkonnectpro.com" },
  { oldEmail: "srinath.sreedharan@tekprocloud.com", newEmail: "srinath.sreedharan@tekkonnectpro.com" },
  { oldEmail: "ruthvik.m@tekprocloud.com", newEmail: "rutvik.mhatre@tekkonnectpro.com" },
  { oldEmail: "manoj.k@tekprocloud.com", newEmail: "manoj.kumar@tekkonnectpro.com" },
  { oldEmail: "sohel.s@tekprocloud.com", newEmail: "sohel.shaikh@tekkonnectpro.com" },
  { oldEmail: "sparsh@tekprocloud.com", newEmail: "sparsh.thakur@tekkonnectpro.com" },
];

export class CorrectAgentEmails1783950466798 implements MigrationInterface {
  name = "CorrectAgentEmails1783950466798";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [tenant] = await queryRunner.query(`SELECT id FROM tenants WHERE slug = $1`, [TENANT_ZERO_SLUG]);
    if (!tenant) return;

    for (const { oldEmail, newEmail } of EMAIL_CORRECTIONS) {
      await queryRunner.query(`UPDATE users SET email = $1 WHERE tenant_id = $2 AND email = $3`, [
        newEmail,
        tenant.id,
        oldEmail,
      ]);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [tenant] = await queryRunner.query(`SELECT id FROM tenants WHERE slug = $1`, [TENANT_ZERO_SLUG]);
    if (!tenant) return;

    for (const { oldEmail, newEmail } of EMAIL_CORRECTIONS) {
      await queryRunner.query(`UPDATE users SET email = $1 WHERE tenant_id = $2 AND email = $3`, [
        oldEmail,
        tenant.id,
        newEmail,
      ]);
    }
  }
}
