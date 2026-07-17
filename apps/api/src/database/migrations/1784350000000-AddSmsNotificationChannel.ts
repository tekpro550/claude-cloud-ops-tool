import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds 'sms' to notification_channel_enum. Voice already exists (previously a
 * stub); this makes SMS a first-class escalation channel alongside it, so an
 * escalation step can page by text or a phone call, not just email/Slack.
 *
 * PostgreSQL can't drop an enum value in place, so down() recreates the type
 * without 'sms' and re-points the three columns that use it (fails, correctly,
 * if any row already uses 'sms').
 */
export class AddSmsNotificationChannel1784350000000 implements MigrationInterface {
  name = 'AddSmsNotificationChannel1784350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE notification_channel_enum ADD VALUE IF NOT EXISTS 'sms'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE notification_channel_enum RENAME TO notification_channel_enum_old`,
    );
    await queryRunner.query(
      `CREATE TYPE notification_channel_enum AS ENUM ('email', 'whatsapp', 'voice', 'in_app', 'slack', 'webhook')`,
    );
    for (const [table, column] of [
      ['notifications', 'channel'],
      ['notification_templates', 'channel'],
      ['cost_budgets', 'notify_channel'],
    ] as const) {
      await queryRunner.query(
        `ALTER TABLE ${table} ALTER COLUMN ${column} TYPE notification_channel_enum
         USING ${column}::text::notification_channel_enum`,
      );
    }
    await queryRunner.query(`DROP TYPE notification_channel_enum_old`);
  }
}
