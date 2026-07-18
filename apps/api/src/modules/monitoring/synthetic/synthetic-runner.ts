import { SyntheticStep } from './synthetic-script';

export interface SyntheticStepResult {
  index: number;
  action: string;
  status: 'ok' | 'failed';
  durationMs: number;
  error?: string;
}

export interface SyntheticRunResult {
  ok: boolean;
  totalMs: number;
  steps: SyntheticStepResult[];
  failingStepIndex: number | null;
}

export interface SyntheticRunOptions {
  maxStepMs: number;
}

/**
 * One implementation (PlaywrightSyntheticRunner) behind this interface, the
 * same shape as CloudProviderClient / ObjectStorage in this codebase --
 * lets SyntheticSchedulerService stay runner-agnostic and, more importantly,
 * lets it be verified against a fake with no real browser (see
 * scripts/verify-synthetic.ts).
 */
export interface SyntheticRunner {
  run(
    steps: SyntheticStep[],
    opts: SyntheticRunOptions,
  ): Promise<SyntheticRunResult>;
}

export const SYNTHETIC_RUNNER = Symbol('SYNTHETIC_RUNNER');
