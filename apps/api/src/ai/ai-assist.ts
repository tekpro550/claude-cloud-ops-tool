import { AiCompletionClient } from './ai-completion.client';
import { TenantAiSettingsService } from './tenant-ai-settings.service';

export interface AiAssistResult {
  enabled: boolean;
  result?: string;
}

export async function runAssist(
  client: AiCompletionClient,
  system: string,
  user: string,
): Promise<AiAssistResult> {
  if (!client.enabled) return { enabled: false };
  const result = await client.complete(system, user);
  return { enabled: true, result };
}

export async function resolveClient(
  settings: TenantAiSettingsService,
  envClient: AiCompletionClient,
  tenantId: string,
): Promise<AiCompletionClient> {
  return (await settings.resolveClient(tenantId)) ?? envClient;
}
