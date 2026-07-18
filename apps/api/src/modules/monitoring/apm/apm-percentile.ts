/**
 * Pure latency aggregation helpers -- nearest-rank percentiles (not
 * interpolated; simple, deterministic, and the standard "p95 of N samples"
 * definition most APM tools use) and the standard Apdex formula
 * (satisfied + tolerating/2) / total, where "satisfied" is duration <= T
 * and "tolerating" is T < duration <= 4T (frustrated beyond that).
 */

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index];
}

export interface LatencyStats {
  count: number;
  errorCount: number;
  errorRatePct: number;
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  apdex: number | null;
}

export function computeLatencyStats(
  durations: number[],
  statuses: string[],
  apdexToleratingMs: number,
): LatencyStats {
  const count = durations.length;
  if (count === 0) {
    return {
      count: 0,
      errorCount: 0,
      errorRatePct: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      avg: 0,
      apdex: null,
    };
  }
  const errorCount = statuses.filter((s) => s === 'error').length;
  const avg = durations.reduce((sum, d) => sum + d, 0) / count;

  let satisfied = 0;
  let tolerating = 0;
  for (const d of durations) {
    if (d <= apdexToleratingMs) satisfied++;
    else if (d <= apdexToleratingMs * 4) tolerating++;
  }
  const apdex = (satisfied + tolerating / 2) / count;

  return {
    count,
    errorCount,
    errorRatePct: (errorCount / count) * 100,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    avg,
    apdex,
  };
}
