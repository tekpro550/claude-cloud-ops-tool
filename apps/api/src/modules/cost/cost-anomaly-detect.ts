/**
 * Pure spend-anomaly test. A day's spend on a service is anomalous when it
 * both jumps a meaningful percentage above the trailing baseline *and* the
 * absolute jump clears a floor -- so a $0.01 -> $0.03 blip (200%) doesn't
 * cry wolf, but a real $310/day EC2 spike does.
 */
export interface AnomalyThresholds {
  minDeviationPct: number;
  minAbsoluteIncrease: number;
}

export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = {
  minDeviationPct: 50,
  minAbsoluteIncrease: 5,
};

export interface AnomalyResult {
  isAnomaly: boolean;
  deviationPct: number;
}

export function detectAnomaly(
  baselineDaily: number,
  actual: number,
  thresholds: AnomalyThresholds = DEFAULT_ANOMALY_THRESHOLDS,
): AnomalyResult {
  const increase = actual - baselineDaily;
  // Percentage vs the baseline; when the baseline is ~0, treat any real
  // spend as a large deviation rather than dividing by zero.
  const deviationPct =
    baselineDaily > 0.01
      ? (increase / baselineDaily) * 100
      : actual > 0
        ? 1000
        : 0;
  const isAnomaly =
    increase >= thresholds.minAbsoluteIncrease &&
    deviationPct >= thresholds.minDeviationPct;
  return { isAnomaly, deviationPct: Math.round(deviationPct) };
}

export function anomalyReasonText(
  service: string,
  region: string | null,
  baselineDaily: number,
  actual: number,
  deviationPct: number,
): string {
  const where = region ? `${service} in ${region}` : service;
  return (
    `${where} spend rose ${deviationPct}% to $${actual.toFixed(2)}/day ` +
    `(baseline ~$${baselineDaily.toFixed(2)}/day).`
  );
}
