import { CloudMetricSample } from '../cloud/cloud-provider-client';
import { CheckResult } from './types';

export interface CloudMetricThresholds {
  warnPercent?: number;
  criticalPercent?: number;
}

const DEFAULT_WARN_PERCENT = 80;
const DEFAULT_CRITICAL_PERCENT = 95;

/**
 * Same shape as evaluateAgentReport -- takes whatever the provider client
 * returned (empty if the provider had no recent data point) and turns it
 * into a CheckResult on the same up/trouble/critical/down scale every other
 * checker uses.
 */
export function evaluateCloudMetrics(
  config: CloudMetricThresholds,
  samples: CloudMetricSample[],
): CheckResult {
  if (samples.length === 0) {
    return {
      status: 'down',
      responseTimeMs: null,
      rawOutput: {
        error: 'no metric data returned by the provider for this resource',
      },
    };
  }

  const primary = samples[0];
  const warn = config.warnPercent ?? DEFAULT_WARN_PERCENT;
  const critical = config.criticalPercent ?? DEFAULT_CRITICAL_PERCENT;
  const rawOutput = {
    metricName: primary.metricName,
    value: primary.value,
    unit: primary.unit,
  };

  if (primary.value >= critical) {
    return {
      status: 'critical',
      responseTimeMs: null,
      rawOutput: { ...rawOutput, reason: 'metric_critical' },
    };
  }
  if (primary.value >= warn) {
    return {
      status: 'trouble',
      responseTimeMs: null,
      rawOutput: { ...rawOutput, reason: 'metric_high' },
    };
  }
  return { status: 'up', responseTimeMs: null, rawOutput };
}
