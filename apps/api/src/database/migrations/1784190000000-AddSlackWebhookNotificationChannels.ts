import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds 'slack' and 'webhook' to notification_channel_enum so alerts and
 * escalations can reach beyond email -- the review flagged email-only
 * alerting as the critical monitoring gap. Slack incoming webhooks and a
 * generic JSON webhook are the two lowest-friction, highest-value channels
 * to add first.
 *
 * PostgreSQL can't drop an enum value in place, so down() recreates the
 * type without the two new values and re-points the three columns that use
 * it. That reversal fails (correctly) if any row already uses a new value.
 */
export class AddSlackWebhookNotificationChannels1784190000000 implements MigrationInterface {
  name = 'AddSlackWebhookNotificationChannels1784190000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE notification_channel_enum ADD VALUE IF NOT EXISTS 'slack'`,
    );
    await queryRunner.query(
      `ALTER TYPE notification_channel_enum ADD VALUE IF NOT EXISTS 'webhook'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE notification_channel_enum RENAME TO notification_channel_enum_old`,
    );
    await queryRunner.query(
      `CREATE TYPE notification_channel_enum AS ENUM ('email', 'whatsapp', 'voice', 'in_app')`,
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
