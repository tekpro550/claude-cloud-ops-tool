import { SyntheticStep } from '../synthetic/synthetic-script';
import {
  SyntheticRunOptions,
  SyntheticRunner,
  SyntheticRunResult,
  SyntheticStepResult,
} from '../synthetic/synthetic-runner';

export interface ScriptedStepOutcome {
  durationMs: number;
  fail?: boolean;
  error?: string;
}

/**
 * In-memory stand-in for PlaywrightSyntheticRunner, used only by
 * verify-synthetic.ts. Scripts each step's duration and pass/fail up front
 * (setOutcomes) and enforces opts.maxStepMs itself the same way the real
 * runner's withTimeout race does -- so a scripted "slow step" scenario
 * exercises SyntheticSchedulerService's actual timeout-driven failure path,
 * not just a hardcoded result, with no real browser involved.
 */
export class FakeSyntheticRunner implements SyntheticRunner {
  private outcomes: ScriptedStepOutcome[] = [];

  setOutcomes(outcomes: ScriptedStepOutcome[]): void {
    this.outcomes = outcomes;
  }

  async run(
    steps: SyntheticStep[],
    opts: SyntheticRunOptions,
  ): Promise<SyntheticRunResult> {
    const results: SyntheticStepResult[] = [];
    let failingStepIndex: number | null = null;
    let totalMs = 0;

    for (let index = 0; index < steps.length; index++) {
      const outcome = this.outcomes[index] ?? { durationMs: 10 };
      totalMs += outcome.durationMs;
      const timedOut = outcome.durationMs > opts.maxStepMs;
      const failed = Boolean(outcome.fail) || timedOut;
      results.push({
        index,
        action: steps[index].action,
        status: failed ? 'failed' : 'ok',
        durationMs: outcome.durationMs,
        error: failed
          ? (outcome.error ??
            (timedOut ? 'step exceeded maxStepMs' : 'step failed'))
          : undefined,
      });
      if (failed) {
        failingStepIndex = index;
        break;
      }
    }

    return {
      ok: failingStepIndex === null,
      totalMs,
      steps: results,
      failingStepIndex,
    };
  }
}
