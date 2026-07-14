import { CheckResult } from './types';

export interface AgentReport {
  cpuPercent?: number;
  memPercent?: number;
  diskPercent?: number;
}

export interface AgentReportThresholds {
  cpuWarnPercent?: number;
  cpuCriticalPercent?: number;
  memWarnPercent?: number;
  memCriticalPercent?: number;
  diskWarnPercent?: number;
  diskCriticalPercent?: number;
}

const DEFAULT_WARN = { cpu: 80, mem: 85, disk: 85 };
const DEFAULT_CRITICAL = { cpu: 95, mem: 95, disk: 95 };

/**
 * Derives a CheckResult from a self-reported metrics snapshot instead of an
 * active network probe -- same CheckResult shape as the other checkers so it
 * flows through the exact same monitor_checks insert + AlertEvaluationService
 * path (see AgentIngestionService).
 */
export function evaluateAgentReport(
  config: AgentReportThresholds,
  report: AgentReport,
): CheckResult {
  const metrics = (
    [
      {
        name: 'cpu',
        value: report.cpuPercent,
        warn: config.cpuWarnPercent ?? DEFAULT_WARN.cpu,
        critical: config.cpuCriticalPercent ?? DEFAULT_CRITICAL.cpu,
      },
      {
        name: 'mem',
        value: report.memPercent,
        warn: config.memWarnPercent ?? DEFAULT_WARN.mem,
        critical: config.memCriticalPercent ?? DEFAULT_CRITICAL.mem,
      },
      {
        name: 'disk',
        value: report.diskPercent,
        warn: config.diskWarnPercent ?? DEFAULT_WARN.disk,
        critical: config.diskCriticalPercent ?? DEFAULT_CRITICAL.disk,
      },
    ] as const
  ).filter((m): m is typeof m & { value: number } => m.value !== undefined);

  const rawOutput: Record<string, unknown> = {};
  for (const m of metrics) rawOutput[`${m.name}Percent`] = m.value;

  const critical = metrics.find((m) => m.value >= m.critical);
  if (critical) {
    return {
      status: 'critical',
      responseTimeMs: null,
      rawOutput: { ...rawOutput, reason: `${critical.name}_critical` },
    };
  }

  const warning = metrics.find((m) => m.value >= m.warn);
  if (warning) {
    return {
      status: 'trouble',
      responseTimeMs: null,
      rawOutput: { ...rawOutput, reason: `${warning.name}_high` },
    };
  }

  return { status: 'up', responseTimeMs: null, rawOutput };
}
