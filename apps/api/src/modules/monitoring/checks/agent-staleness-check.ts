import { CheckResult } from './types';

/**
 * Unlike the other checkers, this doesn't reach out over the network -- it
 * asks "have we heard from this device recently" using agent_tokens.
 * last_seen_at, which both /agent/heartbeat and /agent/report update. Used
 * by MonitorSchedulerService for 'server_agent' monitors, which are never
 * scheduler-polled the way http/ping/port/dns/ssl are (see checks/index.ts).
 */
export function checkAgentStaleness(
  lastSeenAt: Date | null,
  thresholdSeconds: number,
): CheckResult {
  if (!lastSeenAt) {
    return {
      status: 'down',
      responseTimeMs: null,
      rawOutput: {
        error: 'no report or heartbeat has ever been received from this agent',
      },
    };
  }

  const ageSeconds = (Date.now() - lastSeenAt.getTime()) / 1000;
  if (ageSeconds > thresholdSeconds) {
    return {
      status: 'down',
      responseTimeMs: null,
      rawOutput: {
        error: `agent has not reported in ${Math.floor(ageSeconds)}s (threshold ${thresholdSeconds}s)`,
        lastSeenAt: lastSeenAt.toISOString(),
      },
    };
  }

  return {
    status: 'up',
    responseTimeMs: null,
    rawOutput: { lastSeenAt: lastSeenAt.toISOString() },
  };
}
