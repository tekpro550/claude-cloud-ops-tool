import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  AI_COMPLETION_CLIENT,
  AiCompletionClient,
} from '../../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../../ai/tenant-ai-settings.service';
import { SyntheticScript, validateSyntheticScript } from './synthetic-script';

const GEN_SYSTEM =
  'You are a browser automation expert. Given a plain-English description of a user journey, ' +
  'generate a valid synthetic monitor script as JSON. The script must be: ' +
  '{ "steps": [...], "maxStepMs": 15000 } where each step is one of:\n' +
  '  {"action":"goto","url":"https://..."}\n' +
  '  {"action":"click","selector":"css-selector"}\n' +
  '  {"action":"fill","selector":"css-selector","value":"text"}\n' +
  '  {"action":"expectText","selector":"css-selector","value":"expected text"}\n' +
  'Use only these four actions. Selectors should be stable CSS selectors (prefer data-testid, ' +
  'id, or semantic HTML over fragile class chains). maxStepMs is 1000-120000. ' +
  'Output JSON only, no prose, no markdown fences.';

@Injectable()
export class SyntheticScriptGenService {
  constructor(
    @Inject(AI_COMPLETION_CLIENT)
    private readonly envClient: AiCompletionClient,
    private readonly settings: TenantAiSettingsService,
  ) {}

  /**
   * Generates a synthetic monitor script from a natural-language description.
   * The output is validated through validateSyntheticScript() — if AI returns
   * invalid JSON or disallowed actions, an error is thrown before anything is saved.
   */
  async generateScript(
    tenantId: string,
    description: string,
  ): Promise<SyntheticScript> {
    if (!description || description.trim().length === 0) {
      throw new BadRequestException('description must not be empty');
    }
    if (description.length > 2000) {
      throw new BadRequestException(
        'description must be at most 2000 characters',
      );
    }

    const client =
      (await this.settings.resolveClient(tenantId)) ?? this.envClient;
    if (!client.enabled) {
      throw new BadRequestException(
        'AI assist is not configured for this tenant',
      );
    }

    let raw: string;
    try {
      raw = await client.complete(GEN_SYSTEM, description);
    } catch (err) {
      throw new BadRequestException(
        `AI generation failed: ${(err as Error).message}`,
      );
    }

    // Extract JSON from response (strip any prose / fences)
    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!json) {
      throw new BadRequestException(
        'AI did not return a valid JSON script. Try rephrasing the description.',
      );
    }

    let config: Record<string, unknown>;
    try {
      config = JSON.parse(json) as Record<string, unknown>;
    } catch {
      throw new BadRequestException(
        'AI returned malformed JSON. Try rephrasing the description.',
      );
    }

    // Validate through the same gate MonitorsService uses — if this passes,
    // the caller can save the script without any additional validation.
    try {
      return validateSyntheticScript(config);
    } catch (err) {
      throw new BadRequestException(
        `AI-generated script failed validation: ${(err as Error).message}. ` +
          'Try rephrasing or simplifying the description.',
      );
    }
  }
}
