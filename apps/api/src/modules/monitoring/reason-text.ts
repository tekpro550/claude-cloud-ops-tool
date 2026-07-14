import { CheckStatus } from './checks/types';

/**
 * A small fixed template set, not free text -- the same generation path
 * backs alerts.reason_text, the ticket-from-alert description, and repeat
 * failure notes, so an agent sees consistent wording everywhere a check
 * result gets turned into a sentence (Sprint 2 scope section 5).
 */
export function generateReasonText(
  monitorName: string,
  status: CheckStatus,
  rawOutput: Record<string, unknown>,
): string {
  switch (status) {
    case 'up':
      return `${monitorName} is up and responding normally.`;

    case 'down':
      if (rawOutput.error) {
        return `${monitorName} is unreachable: ${rawOutput.error}`;
      }
      return `${monitorName} is down.`;

    case 'critical':
      if (rawOutput.reason === 'expired') {
        return `${monitorName}'s certificate expired on ${rawOutput.expiresAt}.`;
      }
      if (rawOutput.reason === 'value_mismatch') {
        return `${monitorName} resolved to an unexpected value (expected to contain "${rawOutput.expectedValue}").`;
      }
      if (rawOutput.reason === 'body_mismatch') {
        return `${monitorName} responded but its body did not contain the expected text.`;
      }
      if (rawOutput.httpStatus !== undefined) {
        return `${monitorName} responded with HTTP ${rawOutput.httpStatus} (expected ${rawOutput.expectedStatus}).`;
      }
      if (
        typeof rawOutput.reason === 'string' &&
        rawOutput.reason.endsWith('_critical')
      ) {
        const metric = rawOutput.reason.replace('_critical', '');
        return `${monitorName}'s ${metric} usage is at a critical level (${rawOutput[`${metric}Percent`]}%).`;
      }
      return `${monitorName} is reachable but reporting a critical condition.`;

    case 'trouble':
      if (rawOutput.reason === 'expiring_soon') {
        const days = Math.floor(Number(rawOutput.daysRemaining));
        return `${monitorName}'s certificate expires in ${days} day(s).`;
      }
      if (rawOutput.reason === 'slow_response') {
        return `${monitorName} is responding, but slower than expected.`;
      }
      if (
        typeof rawOutput.reason === 'string' &&
        rawOutput.reason.endsWith('_high')
      ) {
        const metric = rawOutput.reason.replace('_high', '');
        return `${monitorName}'s ${metric} usage is elevated (${rawOutput[`${metric}Percent`]}%).`;
      }
      return `${monitorName} is degraded.`;

    default:
      return `${monitorName} reported an unrecognized status.`;
  }
}

export function generateRepeatNoteText(
  monitorName: string,
  status: CheckStatus,
  rawOutput: Record<string, unknown>,
  repeatCount: number,
): string {
  return `Still failing (check #${repeatCount + 1} since this alert opened). ${generateReasonText(monitorName, status, rawOutput)}`;
}
