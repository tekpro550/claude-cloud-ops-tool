// Same convention as types/ticket.ts: raw snake_case rows as the API
// returns them, no camelCase mapping layer.

export type ResourceType = "server" | "cloud_account" | "service" | "website" | "database" | "other";

export interface Resource {
  id: string;
  tenant_id: string;
  name: string;
  resource_type: ResourceType;
  group_name: string | null;
  external_ref: Record<string, unknown>;
  tags: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface FleetSummaryItem {
  id: string;
  name: string;
  resource_type: ResourceType;
  group_name: string | null;
  monitor_count: number;
  worst_status: MonitorStatus | null;
}

export type MonitorType = "http" | "ping" | "port" | "dns" | "ssl" | "server_agent" | "cloud_metric" | "synthetic";
export type MonitorStatus = "up" | "down" | "critical" | "trouble";

export type SyntheticAction = "goto" | "click" | "fill" | "expectText";

export interface SyntheticStep {
  action: SyntheticAction;
  selector?: string;
  url?: string;
  value?: string;
}

export interface SyntheticStepResult {
  index: number;
  action: string;
  status: "ok" | "failed";
  durationMs: number;
  error?: string;
}

export interface Monitor {
  id: string;
  tenant_id: string;
  resource_id: string;
  name: string;
  monitor_type: MonitorType;
  config: Record<string, unknown>;
  interval_seconds: number;
  consecutive_failures_to_alert: number;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
  last_status?: MonitorStatus | null;
  last_checked_at?: string | null;
  last_raw_output?: Record<string, unknown> | null;
}

export interface ResourceDashboard {
  resource: Resource;
  monitors: Monitor[];
  activeAlerts: Alert[];
  openDowntime: DowntimeEvent[];
}

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertRuleKind = "status" | "threshold" | "anomaly";
export type MetricComparator = "gt" | "gte" | "lt" | "lte";
export type AlertMetric = "response_time_ms" | "cpu_percent" | "mem_percent" | "disk_percent" | "cloud_metric_value";

export interface AlertRule {
  id: string;
  tenant_id: string;
  monitor_id: string;
  condition: { statusIn?: string[] };
  severity: AlertSeverity;
  is_enabled: boolean;
  escalation_policy_id: string | null;
  rule_kind: AlertRuleKind;
  metric: AlertMetric | null;
  comparator: MetricComparator | null;
  threshold: number | null;
  for_consecutive: number;
  anomaly_sensitivity: number | null;
  created_at: string;
  updated_at: string;
}

export type AlertStatus = "open" | "acknowledged" | "resolved";

export interface Alert {
  id: string;
  tenant_id: string;
  monitor_id: string;
  alert_rule_id: string | null;
  severity: AlertSeverity;
  status: AlertStatus;
  reason_text: string;
  repeat_count: number;
  ticket_id: string | null;
  opened_at: string;
  last_seen_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  last_escalated_step: number;
}

export interface AgentToken {
  id: string;
  resource_id: string;
  label: string;
  is_enabled: boolean;
  last_seen_at: string | null;
  created_at: string;
  token?: string;
}

export type CloudProvider = "aws" | "azure" | "gcp" | "alibaba" | "digitalocean" | "oracle";

export interface CloudCredential {
  id: string;
  provider: CloudProvider;
  label: string;
  is_enabled: boolean;
  last_polled_at: string | null;
  created_at: string;
}

export interface EscalationNotifyTarget {
  channel: "email" | "whatsapp" | "voice" | "in_app";
  recipient: string;
}

export interface EscalationStep {
  delayMinutes: number;
  notify: EscalationNotifyTarget[];
}

export interface EscalationPolicy {
  id: string;
  name: string;
  steps: EscalationStep[];
  created_at: string;
  updated_at: string;
}

export interface OnCallEntry {
  agentId: string;
  startsAt: string;
  endsAt: string;
}

export interface OnCallSchedule {
  id: string;
  name: string;
  entries: OnCallEntry[];
  created_at: string;
  updated_at: string;
}

export interface NotificationTemplate {
  id: string;
  channel: "email" | "whatsapp" | "voice" | "in_app";
  event_type: string;
  subject: string | null;
  body: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface DowntimeEvent {
  id: string;
  resource_id: string;
  monitor_id: string | null;
  reason: string;
  starts_at: string;
  ends_at: string | null;
  is_manual: boolean;
  created_by: string | null;
  created_at: string;
}

export interface MonitoringDashboardSummary {
  resources: {
    total: number;
    up: number;
    down: number;
    critical: number;
    trouble: number;
    none: number;
  };
  monitors: {
    total: number;
    enabled: number;
  };
  openAlerts: {
    total: number;
    critical: number;
    warning: number;
    info: number;
  };
}

export interface StatusPage {
  id: string;
  tenant_id: string;
  slug: string;
  title: string;
  description?: string | null;
  is_public: boolean;
  created_at: string;
}

export interface StatusPageMonitorLink {
  id: string;
  status_page_id: string;
  monitor_id: string;
  monitor_name: string;
  display_name?: string | null;
  sort_order: number;
}

export interface StatusPageDetail extends StatusPage {
  monitors: StatusPageMonitorLink[];
}

export interface PublicStatusComponent {
  name: string;
  status: MonitorStatus | "unknown";
  uptimePct: number | null;
}

export interface PublicStatus {
  title: string;
  description?: string | null;
  components: PublicStatusComponent[];
}

export type LogLevel = "debug" | "info" | "warn" | "error" | "critical";
export const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error", "critical"];

export interface LogSource {
  id: string;
  tenant_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** Present only in the create() response -- the signed ingest token is never re-displayed. */
  token?: string;
}

export interface LogEntry {
  id: string;
  log_source_id: string;
  ts: string;
  level: LogLevel;
  message: string;
  attributes: Record<string, unknown>;
}

export interface LogAlertRule {
  id: string;
  log_source_id: string;
  name: string;
  match_query: string | null;
  level_at_least: LogLevel;
  window_seconds: number;
  threshold: number;
  is_enabled: boolean;
  last_fired_at: string | null;
  created_at: string;
}

export interface ApmIngestKey {
  id: string;
  tenant_id: string;
  service: string;
  is_active: boolean;
  created_at: string;
  token?: string;
}

export interface ApmServiceSummary {
  service: string;
  trace_count: number;
  last_seen_at: string;
}

export interface ApmTransactionStats {
  transaction: string;
  count: number;
  errorCount: number;
  errorRatePct: number;
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  apdex: number | null;
}

export interface ApmServiceStats {
  service: string;
  overall: Omit<ApmTransactionStats, "transaction">;
  transactions: ApmTransactionStats[];
}

export interface ApmTrace {
  id: string;
  service: string;
  transaction: string;
  ts: string;
  duration_ms: number;
  status: "ok" | "error";
  root: boolean;
}

export interface ApmSpan {
  id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  kind: string;
  duration_ms: number;
  attributes: Record<string, unknown>;
}

export interface RumAppKey {
  id: string;
  tenant_id: string;
  app_name: string;
  is_active: boolean;
  created_at: string;
  token?: string;
}

export interface RumPageSummary {
  page: string;
  event_count: number;
  last_seen_at: string;
}

export interface RumTimingStats {
  metric: "lcp" | "fcp" | "ttfb";
  count: number;
  p50: number;
  p95: number;
}

export interface RumPageStats {
  page: string;
  timings: RumTimingStats[];
  errorCount: number;
  errorRatePct: number;
}

export type SnmpVersion = "1" | "2c" | "3";

export interface NetworkDevice {
  id: string;
  tenant_id: string;
  name: string;
  host: string;
  snmp_version: SnmpVersion;
  port: number;
  is_active: boolean;
  last_polled_at: string | null;
  created_at: string;
}

export type InterfaceOperStatus = "up" | "down" | "unknown";

export interface NetworkInterfaceSample {
  id: string;
  network_device_id: string;
  if_index: number;
  if_name: string | null;
  oper_status: InterfaceOperStatus;
  in_octets: number;
  out_octets: number;
  ts: string;
}
