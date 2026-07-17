import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { OpenAiCompatibleCompletionClient } from '../ai-completion.client';
import { TenantAiSettingsService } from '../tenant-ai-settings.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`AI settings verification FAILED: ${message}`);
  }
  console.log(`  OK  ${message}`);
}

function migratorClient() {
  return new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? 'cloud_ops_tool',
    user: process.env.DB_MIGRATOR_USER ?? 'postgres',
    password: process.env.DB_MIGRATOR_PASSWORD ?? 'postgres',
  });
}

/**
 * Proves the per-tenant AI provider config: the API key is encrypted at rest
 * and never returned, a saved provider resolves to a working client, updating
 * without a key keeps the stored one, and disabling turns the client off.
 */
async function main() {
  const migrator = migratorClient();
  await migrator.connect();
  const slug = `ai-settings-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['AI Settings Verify', slug],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const settings = app.get(TenantAiSettingsService);

  try {
    // No row yet -> null (TicketAiService falls back to the env client).
    assert(
      (await settings.get(tenant.id)) === null,
      'get() returns null before any config is saved',
    );
    assert(
      (await settings.resolveClient(tenant.id)) === null,
      'resolveClient() returns null before any config is saved',
    );

    // Configure an open (OpenAI-compatible / self-hosted) provider with a key.
    const saved = await settings.upsert(tenant.id, {
      provider: 'openai_compatible',
      model: 'llama3.1',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: 'super-secret-key',
      isEnabled: true,
    });
    assert(
      saved.provider === 'openai_compatible',
      'upsert stores the provider',
    );
    assert(saved.has_api_key === true, 'upsert reports a key is stored');
    assert(
      !('api_key' in saved) && !('api_key_encrypted' in saved),
      'the API key is never returned by the service',
    );

    // The key is encrypted at rest: the raw bytea column must not contain the plaintext.
    const {
      rows: [raw],
    } = await migrator.query(
      `SELECT convert_from(api_key_encrypted, 'UTF8') LIKE '%super-secret-key%' AS leaks
       FROM tenant_ai_settings WHERE tenant_id = $1`,
      [tenant.id],
    );
    assert(
      raw.leaks === false,
      'the API key is stored encrypted, not as plaintext',
    );

    // A saved+enabled provider resolves to a real (OpenAI-compatible) client.
    const client = await settings.resolveClient(tenant.id);
    assert(
      client instanceof OpenAiCompatibleCompletionClient && client.enabled,
      'resolveClient() builds an enabled OpenAI-compatible client for an open provider',
    );

    // Update the model without re-supplying the key -> the stored key is kept.
    await settings.upsert(tenant.id, {
      provider: 'openai_compatible',
      model: 'llama3.1:70b',
      baseUrl: 'http://localhost:11434/v1',
    });
    const {
      rows: [afterUpdate],
    } = await migrator.query(
      `SELECT model, api_key_encrypted IS NOT NULL AS has_key
       FROM tenant_ai_settings WHERE tenant_id = $1`,
      [tenant.id],
    );
    assert(
      afterUpdate.model === 'llama3.1:70b' && afterUpdate.has_key === true,
      'updating without an apiKey changes the model but keeps the stored key',
    );

    // Disabling turns the resolved client off (returns {enabled:false}).
    await settings.upsert(tenant.id, {
      provider: 'openai_compatible',
      model: 'llama3.1:70b',
      baseUrl: 'http://localhost:11434/v1',
      isEnabled: false,
    });
    const disabledClient = await settings.resolveClient(tenant.id);
    assert(
      !!disabledClient && disabledClient.enabled === false,
      'a disabled provider resolves to a disabled client',
    );

    console.log('\nAll AI settings checks passed.');
  } finally {
    await migrator.query(
      `DELETE FROM tenant_ai_settings WHERE tenant_id = $1`,
      [tenant.id],
    );
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
    await migrator.end();
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
