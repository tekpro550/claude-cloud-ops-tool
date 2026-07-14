import { dnsCheck } from './dns-check';
import { httpCheck } from './http-check';
import { pingCheck } from './ping-check';
import { portCheck } from './port-check';
import { sslCheck } from './ssl-check';
import {
  CheckResult,
  DnsCheckConfig,
  HttpCheckConfig,
  MonitorType,
  PingCheckConfig,
  PortCheckConfig,
  SslCheckConfig,
} from './types';

export * from './types';

/**
 * Dispatches to the checker for an actively-polled monitor type. 'server_agent'
 * and 'cloud_metric' are deliberately not handled here -- their monitor_checks
 * rows are written by the ingestion endpoints (Sprint 3/4) when data arrives,
 * not by the scheduler polling out. MonitorSchedulerService's due-monitor
 * query only selects the five types below, so this only exists as a
 * defensive guard against a caller bypassing that filter.
 */
export function runCheck(
  monitorType: MonitorType,
  config: Record<string, unknown>,
): Promise<CheckResult> {
  switch (monitorType) {
    case 'http':
      return httpCheck(config as unknown as HttpCheckConfig);
    case 'ping':
      return pingCheck(config as unknown as PingCheckConfig);
    case 'port':
      return portCheck(config as unknown as PortCheckConfig);
    case 'dns':
      return dnsCheck(config as unknown as DnsCheckConfig);
    case 'ssl':
      return sslCheck(config as unknown as SslCheckConfig);
    default:
      throw new Error(
        `monitor_type '${monitorType}' is not scheduler-driven -- checks arrive via ingestion, not active polling`,
      );
  }
}
