export type MonitorType =
  'http' | 'ping' | 'port' | 'dns' | 'ssl' | 'server_agent' | 'cloud_metric';

export type CheckStatus = 'up' | 'down' | 'critical' | 'trouble';

export interface CheckResult {
  status: CheckStatus;
  responseTimeMs: number | null;
  rawOutput: Record<string, unknown>;
}

export interface HttpCheckConfig {
  url: string;
  method?: string;
  expectedStatus?: number;
  bodyContains?: string;
  timeoutMs?: number;
  /** Above this, a successful check is reported as 'trouble' instead of 'up'. Defaults to 80% of timeoutMs. */
  degradedThresholdMs?: number;
}

export interface PingCheckConfig {
  host: string;
  timeoutMs?: number;
}

export interface PortCheckConfig {
  host: string;
  port: number;
  timeoutMs?: number;
}

export interface DnsCheckConfig {
  hostname: string;
  recordType?: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT';
  expectedValue?: string;
  timeoutMs?: number;
}

export interface SslCheckConfig {
  host: string;
  port?: number;
  warnDaysBeforeExpiry?: number;
  timeoutMs?: number;
}
