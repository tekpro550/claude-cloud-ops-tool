import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../database/context/tenant-context';
import { credentialsEncryptionKey } from '../modules/monitoring/credentials-crypto';
import {
  AiCompletionClient,
  buildCompletionClient,
  DisabledCompletionClient,
} from './ai-completion.client';
import { UpdateTenantAiSettingsDto } from './tenant-ai-settings.dto';

// The API key is never selected back out — only a boolean saying whether one
// is stored, same write-only ethos as cloud_credentials and agent tokens.
const SAFE_COLUMNS =
  'id, provider, model, base_url, is_enabled, (api_key_encrypted IS NOT NULL) AS has_api_key, updated_at';

/**
 * Per-tenant AI-assist provider settings. Stores the provider/model/base URL
 * and a pgcrypto-encrypted API key, and resolves the runtime completion client
 * TicketAiService uses. Reads/writes go through withTenantContext so RLS scopes
 * every row to the current tenant.
 */
@Injectable()
export class TenantAiSettingsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  /** Current settings for a tenant, or null if it hasn't configured AI. Never includes the key. */
  get(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [row] = await qr.query(
        `SELECT ${SAFE_COLUMNS} FROM tenant_ai_settings WHERE tenant_id = $1`,
        [tenantId],
      );
      return row ?? null;
    });
  }

  async upsert(tenantId: string, dto: UpdateTenantAiSettingsDto) {
    if (dto.provider === 'openai_compatible' && !dto.baseUrl) {
      throw new BadRequestException(
        'baseUrl is required for an open (OpenAI-compatible) provider',
      );
    }
    const key = credentialsEncryptionKey(this.config);
    // Only replace the stored key when a non-empty one is supplied, so an admin
    // can tweak the model without re-entering the secret.
    const apiKey = dto.apiKey && dto.apiKey.length > 0 ? dto.apiKey : null;
    const isEnabled = dto.isEnabled ?? true;

    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [existing] = await qr.query(
        `SELECT id FROM tenant_ai_settings WHERE tenant_id = $1`,
        [tenantId],
      );

      if (!existing) {
        await qr.query(
          `INSERT INTO tenant_ai_settings
             (tenant_id, provider, model, base_url, api_key_encrypted, is_enabled)
           VALUES ($1, $2, $3, $4,
             CASE WHEN $5::text IS NULL THEN NULL ELSE pgp_sym_encrypt($5, $6) END,
             $7)`,
          [
            tenantId,
            dto.provider,
            dto.model,
            dto.baseUrl ?? null,
            apiKey,
            key,
            isEnabled,
          ],
        );
      } else {
        const sets = [
          'provider = $2',
          'model = $3',
          'base_url = $4',
          'is_enabled = $5',
          'updated_at = now()',
        ];
        const params: unknown[] = [
          tenantId,
          dto.provider,
          dto.model,
          dto.baseUrl ?? null,
          isEnabled,
        ];
        if (apiKey !== null) {
          params.push(apiKey, key);
          sets.push(
            `api_key_encrypted = pgp_sym_encrypt($${params.length - 1}, $${params.length})`,
          );
        }
        await qr.query(
          `UPDATE tenant_ai_settings SET ${sets.join(', ')} WHERE tenant_id = $1`,
          params,
        );
      }

      const [row] = await qr.query(
        `SELECT ${SAFE_COLUMNS} FROM tenant_ai_settings WHERE tenant_id = $1`,
        [tenantId],
      );
      return row;
    });
  }

  /**
   * Resolve the runtime completion client for a tenant, decrypting the key.
   * Returns null when the tenant has no settings row, so callers can
   * fall back to the process-wide env client; a disabled row yields a
   * DisabledCompletionClient.
   */
  resolveClient(tenantId: string): Promise<AiCompletionClient | null> {
    const key = credentialsEncryptionKey(this.config);
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [row] = await qr.query(
        `SELECT provider, model, base_url, is_enabled,
                CASE WHEN api_key_encrypted IS NULL THEN NULL
                     ELSE pgp_sym_decrypt(api_key_encrypted, $2) END AS api_key
         FROM tenant_ai_settings WHERE tenant_id = $1`,
        [tenantId, key],
      );
      if (!row) return null;
      if (!row.is_enabled) return new DisabledCompletionClient();
      return buildCompletionClient({
        provider: row.provider,
        model: row.model,
        baseUrl: row.base_url ?? null,
        apiKey: row.api_key ?? null,
      });
    });
  }
}
