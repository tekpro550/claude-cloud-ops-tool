import { BadRequestException } from '@nestjs/common';

/**
 * A synthetic monitor's config is arbitrary tenant-supplied jsonb, so this
 * validates it into a well-typed script before anything ever runs it in a
 * browser. Every step's action must be one of SYNTHETIC_ACTIONS -- an
 * unrecognized action, or a step missing the fields its action needs,
 * throws BadRequestException before the monitor is ever saved. Same
 * reject-before-save contract as ticketing/reports/report-builder.ts's
 * metric/dimension allowlist.
 */
export const SYNTHETIC_ACTIONS = [
  'goto',
  'click',
  'fill',
  'expectText',
] as const;
export type SyntheticAction = (typeof SYNTHETIC_ACTIONS)[number];

export interface SyntheticStep {
  action: SyntheticAction;
  selector?: string;
  url?: string;
  value?: string;
}

export interface SyntheticScript {
  steps: SyntheticStep[];
  maxStepMs: number;
}

const DEFAULT_MAX_STEP_MS = 15_000;
const MIN_MAX_STEP_MS = 1_000;
const MAX_MAX_STEP_MS = 120_000;

function validateStep(step: unknown, index: number): SyntheticStep {
  if (typeof step !== 'object' || step === null) {
    throw new BadRequestException(`Synthetic step ${index} must be an object`);
  }
  const s = step as Record<string, unknown>;
  if (
    typeof s.action !== 'string' ||
    !(SYNTHETIC_ACTIONS as readonly string[]).includes(s.action)
  ) {
    throw new BadRequestException(
      `Synthetic step ${index} has an unknown action "${String(s.action)}"`,
    );
  }
  const action = s.action as SyntheticAction;

  if (action === 'goto') {
    if (typeof s.url !== 'string' || !s.url) {
      throw new BadRequestException(
        `Synthetic step ${index} (goto) requires a "url"`,
      );
    }
    return { action, url: s.url };
  }

  if (typeof s.selector !== 'string' || !s.selector) {
    throw new BadRequestException(
      `Synthetic step ${index} (${action}) requires a "selector"`,
    );
  }
  if (
    (action === 'fill' || action === 'expectText') &&
    typeof s.value !== 'string'
  ) {
    throw new BadRequestException(
      `Synthetic step ${index} (${action}) requires a "value"`,
    );
  }
  return {
    action,
    selector: s.selector,
    value: typeof s.value === 'string' ? s.value : undefined,
  };
}

export function validateSyntheticScript(
  config: Record<string, unknown>,
): SyntheticScript {
  if (!Array.isArray(config.steps) || config.steps.length === 0) {
    throw new BadRequestException(
      'A synthetic monitor needs a non-empty "steps" array',
    );
  }
  const steps = config.steps.map((step, index) => validateStep(step, index));

  let maxStepMs = DEFAULT_MAX_STEP_MS;
  if (config.maxStepMs !== undefined) {
    if (
      typeof config.maxStepMs !== 'number' ||
      config.maxStepMs < MIN_MAX_STEP_MS ||
      config.maxStepMs > MAX_MAX_STEP_MS
    ) {
      throw new BadRequestException(
        `"maxStepMs" must be a number between ${MIN_MAX_STEP_MS} and ${MAX_MAX_STEP_MS}`,
      );
    }
    maxStepMs = config.maxStepMs;
  }

  return { steps, maxStepMs };
}
