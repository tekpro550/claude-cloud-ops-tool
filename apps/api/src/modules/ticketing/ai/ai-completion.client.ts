import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** DI token for the pluggable completion backend (real Anthropic, or disabled). */
export const AI_COMPLETION_CLIENT = 'AI_COMPLETION_CLIENT';

/**
 * Minimal completion contract the AI-assist feature depends on. Kept tiny and
 * provider-agnostic so it can be faked in tests without any network or SDK.
 */
export interface AiCompletionClient {
  /** False when no API key is configured -- callers short-circuit and return {enabled:false}. */
  readonly enabled: boolean;
  /** One-shot completion: a system instruction + a user message → assistant text. */
  complete(system: string, user: string): Promise<string>;
}

/** Used when AI assist is off (no key). complete() is never called (enabled guards it). */
export class DisabledCompletionClient implements AiCompletionClient {
  readonly enabled = false;
  async complete(): Promise<string> {
    throw new Error('AI assist is not configured');
  }
}

/**
 * Real backend, backed by the official Anthropic SDK. The SDK is loaded lazily
 * (require in the constructor) so the app still boots when the package isn't
 * installed or the key is unset -- in that case the factory hands back the
 * DisabledCompletionClient instead of this one.
 */
export class AnthropicCompletionClient implements AiCompletionClient {
  readonly enabled = true;
  private readonly logger = new Logger(AnthropicCompletionClient.name);
  private readonly model: string;
  // Typed loosely: the SDK is an optional peer dependency, so we don't import
  // its types at build time.
  private readonly client: {
    messages: {
      create(
        args: unknown,
      ): Promise<{ content: Array<{ type: string; text?: string }> }>;
    };
  };

  constructor(apiKey: string, model: string) {
    this.model = model;
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const mod = require('@anthropic-ai/sdk');
    const Anthropic = mod.default ?? mod;
    this.client = new Anthropic({ apiKey });
  }

  async complete(system: string, user: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = response.content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text as string)
      .join('\n')
      .trim();
    if (!text) {
      this.logger.warn('Anthropic returned an empty completion');
    }
    return text;
  }
}

/**
 * Real backend for any OpenAI-compatible /chat/completions endpoint. Covers
 * both the closed 'openai' provider (base URL https://api.openai.com/v1) and
 * open / self-hosted models (Ollama, vLLM, LM Studio, together.ai, …) that
 * expose the same wire format. Uses global fetch — no SDK/dependency — so an
 * open model needs nothing installed server-side. The API key is optional: a
 * local Ollama endpoint typically needs none.
 */
export class OpenAiCompatibleCompletionClient implements AiCompletionClient {
  readonly enabled = true;
  private readonly logger = new Logger(OpenAiCompatibleCompletionClient.name);

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey: string | null,
  ) {}

  async complete(system: string, user: string): Promise<string> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `AI provider returned ${response.status}: ${body.slice(0, 200)}`,
      );
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) {
      this.logger.warn('AI provider returned an empty completion');
    }
    return text;
  }
}

export type AiProvider = 'anthropic' | 'openai' | 'openai_compatible';

export interface CompletionClientConfig {
  provider: AiProvider;
  model: string;
  apiKey: string | null;
  baseUrl: string | null;
}

/**
 * Builds the right client from a tenant's saved AI settings. Anything that
 * can't produce a working client (a hosted provider with no key, an
 * OpenAI-compatible provider with no base URL) degrades to a
 * DisabledCompletionClient so callers return {enabled:false} rather than
 * throwing.
 */
export function buildCompletionClient(
  config: CompletionClientConfig,
): AiCompletionClient {
  if (config.provider === 'anthropic') {
    if (!config.apiKey) return new DisabledCompletionClient();
    return new AnthropicCompletionClient(config.apiKey, config.model);
  }
  // 'openai' is a closed provider that still speaks the OpenAI wire format and
  // requires a key; 'openai_compatible' is the open/self-hosted case where the
  // caller supplies the base URL and a key may not be needed.
  const baseUrl =
    config.provider === 'openai'
      ? config.baseUrl || 'https://api.openai.com/v1'
      : config.baseUrl;
  if (!baseUrl) return new DisabledCompletionClient();
  if (config.provider === 'openai' && !config.apiKey) {
    return new DisabledCompletionClient();
  }
  return new OpenAiCompatibleCompletionClient(
    baseUrl,
    config.model,
    config.apiKey,
  );
}

/**
 * Factory: build a real client when ANTHROPIC_API_KEY is set and the SDK is
 * importable; otherwise a disabled client. Any failure to construct the real
 * client (missing package, bad config) degrades to disabled rather than
 * crashing the module. This is the process-wide env fallback used when a
 * tenant hasn't configured its own provider in admin.
 */
export function createCompletionClient(
  config: ConfigService,
): AiCompletionClient {
  const logger = new Logger('AiCompletionClientFactory');
  const apiKey = config.get<string>('ANTHROPIC_API_KEY');
  if (!apiKey) {
    logger.log('ANTHROPIC_API_KEY not set — AI assist disabled');
    return new DisabledCompletionClient();
  }
  const model = config.get<string>('AI_ASSIST_MODEL', 'claude-opus-4-8');
  try {
    return new AnthropicCompletionClient(apiKey, model);
  } catch (err) {
    logger.error(
      `Failed to initialize Anthropic client (${(err as Error).message}) — AI assist disabled`,
    );
    return new DisabledCompletionClient();
  }
}
