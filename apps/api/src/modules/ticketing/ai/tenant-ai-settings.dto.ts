import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const AI_PROVIDERS = [
  'anthropic',
  'openai',
  'gemini',
  'grok',
  'llama',
  'openai_compatible',
] as const;

/**
 * Update (upsert) a tenant's AI-assist provider config. `provider` chooses
 * between a closed hosted model (anthropic/openai) and an open, self-hosted
 * one over an OpenAI-compatible endpoint (openai_compatible). `apiKey` is
 * write-only — omit it on a later update to keep the stored key unchanged.
 */
export class UpdateTenantAiSettingsDto {
  @IsIn(AI_PROVIDERS)
  provider: (typeof AI_PROVIDERS)[number];

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  model: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}
