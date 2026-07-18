import type { SyntheticStepResult } from "../types/monitoring";

/**
 * Site24x7-style per-step timing waterfall for a synthetic monitor's most
 * recent run: one bar per step, width proportional to its duration, the
 * failing step (if any) called out in red with its error underneath.
 */
export default function SyntheticWaterfall({
  steps,
  failingStepIndex,
}: {
  steps: SyntheticStepResult[];
  failingStepIndex?: number | null;
}) {
  if (steps.length === 0) return null;
  const maxDuration = Math.max(1, ...steps.map((s) => s.durationMs));
  const failedStep = failingStepIndex != null ? steps[failingStepIndex] : undefined;

  return (
    <div className="synthetic-waterfall">
      {steps.map((step) => (
        <div key={step.index} className="synthetic-waterfall-row">
          <span className="synthetic-waterfall-label">
            {step.index + 1}. {step.action}
          </span>
          <span className="synthetic-waterfall-track">
            <span
              className={`synthetic-waterfall-bar${step.status === "failed" ? " synthetic-waterfall-bar-failed" : ""}`}
              style={{ width: `${Math.max(4, (step.durationMs / maxDuration) * 100)}%` }}
            />
          </span>
          <span className="hint">{step.durationMs}ms</span>
        </div>
      ))}
      {failedStep?.error && <p className="monitor-reason">Step {failedStep.index + 1} failed: {failedStep.error}</p>}
    </div>
  );
}
