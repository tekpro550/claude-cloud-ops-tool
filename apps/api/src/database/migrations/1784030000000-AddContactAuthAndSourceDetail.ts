import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContactAuthAndSourceDetail1784030000000 implements MigrationInterface {
  name = 'AddContactAuthAndSourceDetail1784030000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Schema-only for now -- password_hash/oauth_provider exist so the
    // customer portal (a separate, larger piece of work) has columns ready,
    // but no login logic reads/writes them yet. email_valid is used
    // immediately by the contact validation check below.
    await queryRunner.query(`
      ALTER TABLE contacts
        ADD COLUMN password_hash text,
        ADD COLUMN oauth_provider text,
        ADD COLUMN email_valid boolean NOT NULL DEFAULT true;
    `);

    await queryRunner.query(`
      ALTER TABLE tickets ADD COLUMN source_detail text;
    `);

    // Postgres can't add multiple enum values in the same transaction as
    // using them, but plain additions (no immediate use) are fine here.
    await queryRunner.query(`
      ALTER TYPE ticket_source_enum ADD VALUE IF NOT EXISTS 'web_portal';
      ALTER TYPE ticket_source_enum ADD VALUE IF NOT EXISTS 'agent_outbound';
    `);

    await queryRunner.query(`
      ALTER TYPE automation_trigger_enum ADD VALUE IF NOT EXISTS 'time_based';
      ALTER TYPE automation_trigger_enum ADD VALUE IF NOT EXISTS 'alert_received';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres has no DROP VALUE for enums; left in place on rollback
    // (harmless -- an unused enum value doesn't affect existing rows/queries).
    await queryRunner.query(`
      ALTER TABLE tickets DROP COLUMN IF EXISTS source_detail;
    `);
    await queryRunner.query(`
      ALTER TABLE contacts
        DROP COLUMN IF EXISTS email_valid,
        DROP COLUMN IF EXISTS oauth_provider,
        DROP COLUMN IF EXISTS password_hash;
    `);
  }
}
