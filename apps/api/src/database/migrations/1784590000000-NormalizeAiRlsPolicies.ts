import { MigrationInterface, QueryRunner } from 'typeorm';

const AI_TABLES = [
  'ticket_ai_triage',
  'cost_narratives',
  'ticket_similar_suggestions',
  'kb_articles',
  'ask_sessions',
  'ask_messages',
];

/**
 * The six AI tables shipped with RLS policies using the strict
 * current_setting('app.current_tenant') form, which RAISES an error when the
 * setting is unset. Every other tenant table uses the missing_ok form
 * (NULLIF(current_setting(..., true), '')) so a query outside a tenant
 * context fails closed by returning zero rows — the exact default-deny
 * behavior rls:verify proves. Recreate the six policies in the standard form
 * (with an explicit WITH CHECK, matching tenant_ai_settings) so an accidental
 * bare query degrades to an empty result instead of a 500.
 */
export class NormalizeAiRlsPolicies1784590000000 implements MigrationInterface {
  name = 'NormalizeAiRlsPolicies1784590000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of AI_TABLES) {
      await queryRunner.query(`
        DROP POLICY IF EXISTS tenant_isolation ON ${table};
        CREATE POLICY tenant_isolation ON ${table}
          USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of AI_TABLES) {
      await queryRunner.query(`
        DROP POLICY IF EXISTS tenant_isolation ON ${table};
        CREATE POLICY tenant_isolation ON ${table}
          USING (tenant_id = current_setting('app.current_tenant')::uuid);
      `);
    }
  }
}
