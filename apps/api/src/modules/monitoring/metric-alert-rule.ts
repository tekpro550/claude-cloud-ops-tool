export type AlertRuleKind = 'status' | 'threshold' | 'anomaly';
export type MetricComparator = 'gt' | 'gte' | 'lt' | 'lte';

/**
 * Metrics a threshold/anomaly rule can watch, and the SQL expression that
 * pulls each one out of a monitor_checks row (aliased `mc`) as a double.
 * response_time_ms is a real column; the rest live in raw_output, whose shape
 * differs by monitor type (see evaluateAgentReport / evaluateCloudMetrics).
 * Kept as an explicit allowlist -- same reasoning as the report builder's
 * (task 7) metric/dimension allowlist -- so a rule can never turn into an
 * arbitrary SQL expression.
 */
export const METRICS = [
  'response_time_ms',
  'cpu_percent',
  'mem_percent',
  'disk_percent',
  'cloud_metric_value',
] as const;
export type Metric = (typeof METRICS)[number];

const METRIC_SQL: Record<Metric, string> = {
  response_time_ms: 'mc.response_time_ms::double precision',
  cpu_percent: `(mc.raw_output->>'cpuPercent')::double precision`,
  mem_percent: `(mc.raw_output->>'memPercent')::double precision`,
  disk_percent: `(mc.raw_output->>'diskPercent')::double precision`,
  cloud_metric_value: `(mc.raw_output->>'value')::double precision`,
};

export function metricValueSql(metric: string): string {
  const sql = METRIC_SQL[metric as Metric];
  if (!sql) {
    throw new Error(`Unknown alert rule metric "${metric}"`);
  }
  return sql;
}

export function compare(
  value: number,
  comparator: MetricComparator,
  threshold: number,
): boolean {
  switch (comparator) {
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
  }
}

export interface AnomalyResult {
  isAnomaly: boolean;
  mean: number;
  stddev: number;
  zScore: number;
}

const MIN_BASELINE_SAMPLES = 5;

/**
 * Pure anomaly test (mirrors cost/cost-anomaly-detect.ts): a value is
 * anomalous when it deviates from the trailing baseline's mean by more than
 * `sensitivity` standard deviations. Requires at least MIN_BASELINE_SAMPLES
 * baseline points -- too little history reads as "not yet anomalous" rather
 * than a false positive on day one.
 */
export function detectMetricAnomaly(
  baseline: number[],
  latest: number,
  sensitivity: number,
): AnomalyResult {
  if (baseline.length < MIN_BASELINE_SAMPLES) {
    return { isAnomaly: false, mean: 0, stddev: 0, zScore: 0 };
  }
  const mean = baseline.reduce((sum, v) => sum + v, 0) / baseline.length;
  const variance =
    baseline.reduce((sum, v) => sum + (v - mean) ** 2, 0) / baseline.length;
  const stddev = Math.sqrt(variance);

  if (stddev === 0) {
    // A perfectly flat baseline: any different value is an infinite z-score
    // in spirit -- treat any deviation as anomalous, no deviation as not.
    return {
      isAnomaly: latest !== mean,
      mean,
      stddev,
      zScore: latest === mean ? 0 : Infinity,
    };
  }
  const zScore = (latest - mean) / stddev;
  return { isAnomaly: Math.abs(zScore) >= sensitivity, mean, stddev, zScore };
}
