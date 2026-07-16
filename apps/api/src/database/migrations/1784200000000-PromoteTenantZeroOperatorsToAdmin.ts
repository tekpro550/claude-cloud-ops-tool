import { MigrationInterface, QueryRunner } from 'typeorm';

const TENANT_ZERO_SLUG = 'tekpro-internal';

/**
 * Now that RolesGuard actually enforces users.role, tenant zero needs at
 * least one real admin -- SeedTenantZeroAndAgents created its six founding
 * operators as 'agent', which the new admin-only guards would lock out of
 * cloud credentials, agent management, and tenant cost settings. These six
 * are the pilot's operators, so they become admins here; agents created
 * later through the UI still default to 'agent' and are correctly scoped.
 */
export class PromoteTenantZeroOperatorsToAdmin1784200000000 implements MigrationInterface {
  name = 'PromoteTenantZeroOperatorsToAdmin1784200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE users SET role = 'admin'
       WHERE role = 'agent'
         AND tenant_id = (SELECT id FROM tenants WHERE slug = $1)`,
      [TENANT_ZERO_SLUG],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE users SET role = 'agent'
       WHERE role = 'admin'
         AND tenant_id = (SELECT id FROM tenants WHERE slug = $1)`,
      [TENANT_ZERO_SLUG],
    );
  }
}
