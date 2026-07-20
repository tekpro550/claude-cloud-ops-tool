import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ticket AI triage: stores AI-generated priority/type/tag suggestions for
 * each ticket, with an optional auto-apply mode configured per tenant.
 */
export class CreateTicketAiTriage1784510000000 implements MigrationInterface {
  name = 'CreateTicketAiTriage1784510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE ticket_ai_triage (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        suggested_priority text,
        suggested_type_id uuid,
        suggested_tags text[] NOT NULL DEFAULT '{}',
        suggested_skill text,
        rationale text,
        model text,
        applied boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE ticket_ai_triage ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON ticket_ai_triage
        USING (tenant_id = current_setting('app.current_tenant')::uuid);

      ALTER TABLE tenant_ai_settings
        ADD COLUMN IF NOT EXISTS auto_triage_mode text NOT NULL DEFAULT 'off'
        CHECK (auto_triage_mode IN ('off','suggest','apply'));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tenant_ai_settings DROP COLUMN IF EXISTS auto_triage_mode;
      DROP TABLE IF EXISTS ticket_ai_triage;
    `);
  }
}
