import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widen tenant_ai_settings.provider to include the extra closed hosted
 * providers (gemini, grok, llama) alongside anthropic/openai and the open
 * openai_compatible option. All the new ones speak the OpenAI-compatible wire
 * format, so no schema beyond the CHECK constraint changes.
 */
export class AddAiProviders1784320000000 implements MigrationInterface {
  name = 'AddAiProviders1784320000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tenant_ai_settings DROP CONSTRAINT tenant_ai_settings_provider_check`,
    );
    await queryRunner.query(
      `ALTER TABLE tenant_ai_settings ADD CONSTRAINT tenant_ai_settings_provider_check
         CHECK (provider IN ('anthropic', 'openai', 'gemini', 'grok', 'llama', 'openai_compatible'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tenant_ai_settings DROP CONSTRAINT tenant_ai_settings_provider_check`,
    );
    await queryRunner.query(
      `ALTER TABLE tenant_ai_settings ADD CONSTRAINT tenant_ai_settings_provider_check
         CHECK (provider IN ('anthropic', 'openai', 'openai_compatible'))`,
    );
  }
}
