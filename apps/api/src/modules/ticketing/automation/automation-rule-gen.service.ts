import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  AI_COMPLETION_CLIENT,
  AiCompletionClient,
} from '../../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../../ai/tenant-ai-settings.service';
import {
  ACTION_TYPES,
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  TRIGGERS,
} from './automation-rules.dto';

/** The reviewed-not-saved draft the generator returns to the admin UI. */
export interface GeneratedAutomationRule {
  name: string;
  trigger: (typeof TRIGGERS)[number];
  timeTriggerMinutes?: number;
  conditions: {
    field: (typeof CONDITION_FIELDS)[number];
    operator: (typeof CONDITION_OPERATORS)[number];
    value: string;
  }[];
  actions: { type: (typeof ACTION_TYPES)[number]; value: string }[];
}

const GEN_SYSTEM =
  'You are a helpdesk automation expert. Given a plain-English description of a ticket ' +
  'automation rule, output ONLY valid JSON with this exact shape:\n' +
  '{ "name": "short rule name",\n' +
  `  "trigger": one of [${TRIGGERS.map((t) => `"${t}"`).join(',')}],\n` +
  '  "timeTriggerMinutes": integer >= 1 (ONLY when trigger is "time_based"),\n' +
  `  "conditions": [{"field": one of [${CONDITION_FIELDS.map((f) => `"${f}"`).join(',')}], ` +
  `"operator": one of [${CONDITION_OPERATORS.map((o) => `"${o}"`).join(',')}], "value": "string"}],\n` +
  `  "actions": [{"type": one of [${ACTION_TYPES.map((a) => `"${a}"`).join(',')}], "value": "string"}] }\n` +
  'Use only the listed enum values. Ticket priorities are low/medium/high/urgent and ' +
  'statuses are new/open/pending/resolved/closed. Output JSON only, no prose.';

/**
 * Drafts an automation rule from a natural-language description. The output
 * is validated against the exact same allowlists CreateAutomationRuleDto
 * enforces, and is returned as a DRAFT for the admin to review — saving still
 * goes through the normal POST /automation-rules endpoint, so the global
 * ValidationPipe remains the enforcement point.
 */
@Injectable()
export class AutomationRuleGenService {
  constructor(
    @Inject(AI_COMPLETION_CLIENT)
    private readonly envClient: AiCompletionClient,
    private readonly settings: TenantAiSettingsService,
  ) {}

  async generateRule(
    tenantId: string,
    description: string,
  ): Promise<GeneratedAutomationRule> {
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

    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!json) {
      throw new BadRequestException(
        'AI did not return a valid JSON rule. Try rephrasing the description.',
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(json) as Record<string, unknown>;
    } catch {
      throw new BadRequestException(
        'AI returned malformed JSON. Try rephrasing the description.',
      );
    }

    return this.validateDraft(parsed);
  }

  private validateDraft(parsed: Record<string, unknown>) {
    const fail = (why: string): never => {
      throw new BadRequestException(
        `AI-generated rule failed validation: ${why}. Try rephrasing the description.`,
      );
    };

    const name =
      typeof parsed.name === 'string' && parsed.name.trim().length > 0
        ? parsed.name.trim().slice(0, 200)
        : fail('missing rule name');

    const trigger = (TRIGGERS as readonly string[]).includes(
      String(parsed.trigger),
    )
      ? (String(parsed.trigger) as (typeof TRIGGERS)[number])
      : fail(`unknown trigger "${String(parsed.trigger)}"`);

    let timeTriggerMinutes: number | undefined;
    if (trigger === 'time_based') {
      const mins = Number(parsed.timeTriggerMinutes);
      if (!Number.isInteger(mins) || mins < 1) {
        fail('time_based rules need timeTriggerMinutes >= 1');
      }
      timeTriggerMinutes = mins;
    }

    const rawConditions = Array.isArray(parsed.conditions)
      ? parsed.conditions
      : [];
    const conditions = rawConditions.map((c: Record<string, unknown>) => {
      if (!(CONDITION_FIELDS as readonly string[]).includes(String(c?.field)))
        fail(`unknown condition field "${String(c?.field)}"`);
      if (
        !(CONDITION_OPERATORS as readonly string[]).includes(
          String(c?.operator),
        )
      )
        fail(`unknown condition operator "${String(c?.operator)}"`);
      if (typeof c?.value !== 'string' || c.value.length === 0)
        fail('condition value must be a non-empty string');
      return {
        field: String(c.field) as (typeof CONDITION_FIELDS)[number],
        operator: String(c.operator) as (typeof CONDITION_OPERATORS)[number],
        value: String(c.value).slice(0, 500),
      };
    });

    const rawActions = Array.isArray(parsed.actions) ? parsed.actions : [];
    if (rawActions.length === 0) fail('a rule needs at least one action');
    const actions = rawActions.map((a: Record<string, unknown>) => {
      if (!(ACTION_TYPES as readonly string[]).includes(String(a?.type)))
        fail(`unknown action type "${String(a?.type)}"`);
      if (typeof a?.value !== 'string' || a.value.length === 0)
        fail('action value must be a non-empty string');
      return {
        type: String(a.type) as (typeof ACTION_TYPES)[number],
        value: String(a.value).slice(0, 2000),
      };
    });

    return { name, trigger, timeTriggerMinutes, conditions, actions };
  }
}
