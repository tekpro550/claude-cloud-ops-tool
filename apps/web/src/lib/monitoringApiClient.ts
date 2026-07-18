import { publicRequest, request } from "./apiClient";
import type {
  AgentToken,
  Alert,
  AlertMetric,
  AlertRule,
  AlertRuleKind,
  ApmIngestKey,
  ApmServiceStats,
  ApmServiceSummary,
  ApmSpan,
  ApmTrace,
  CloudCredential,
  DowntimeEvent,
  EscalationPolicy,
  FleetSummaryItem,
  LogAlertRule,
  LogEntry,
  LogSource,
  MetricComparator,
  Monitor,
  MonitoringDashboardSummary,
  MonitorStatus,
  NetworkDevice,
  NetworkInterfaceSample,
  RumAppKey,
  RumPageStats,
  RumPageSummary,
  NotificationTemplate,
  OnCallSchedule,
  PublicStatus,
  Resource,
  ResourceDashboard,
  StatusPage,
  StatusPageDetail,
} from "../types/monitoring";
import type { DashboardTrendPoint } from "../types/ticket";

// ---- Resources ----

export function listResources(tenantId: string): Promise<Resource[]> {
  return request(tenantId, "GET", "/resources");
}

export function createResource(
  tenantId: string,
  input: { name: string; resourceType: string; groupName?: string },
): Promise<Resource> {
  return request(tenantId, "POST", "/resources", input);
}

export function deleteResource(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/resources/${id}`);
}

export function getFleetSummary(tenantId: string): Promise<FleetSummaryItem[]> {
  return request(tenantId, "GET", "/monitoring/fleet_summary");
}

export function getResourceDashboard(tenantId: string, resourceId: string): Promise<ResourceDashboard> {
  return request(tenantId, "GET", `/resources/${resourceId}/dashboard`);
}

// ---- Monitors ----

export function listMonitors(tenantId: string): Promise<Monitor[]> {
  return request(tenantId, "GET", "/monitors");
}

export interface CreateMonitorInput {
  resourceId: string;
  name: string;
  monitorType: string;
  config?: Record<string, unknown>;
  intervalSeconds?: number;
  consecutiveFailuresToAlert?: number;
  minFailingLocations?: number;
  isEnabled?: boolean;
}

export function createMonitor(tenantId: string, input: CreateMonitorInput): Promise<Monitor> {
  return request(tenantId, "POST", "/monitors", input);
}

export function updateMonitor(
  tenantId: string,
  id: string,
  input: Partial<CreateMonitorInput>,
): Promise<Monitor> {
  return request(tenantId, "PATCH", `/monitors/${id}`, input);
}

export function deleteMonitor(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/monitors/${id}`);
}

export interface MonitorCheck {
  status: MonitorStatus;
  checked_at: string;
  response_time_ms: number | null;
}

export function getMonitorChecks(tenantId: string, monitorId: string, limit = 50): Promise<MonitorCheck[]> {
  return request(tenantId, "GET", `/monitors/${monitorId}/checks?limit=${limit}`);
}

// ---- Alert rules ----

export function listAlertRules(tenantId: string): Promise<AlertRule[]> {
  return request(tenantId, "GET", "/alert-rules");
}

export interface CreateAlertRuleInput {
  monitorId: string;
  severity?: string;
  escalationPolicyId?: string;
  ruleKind?: AlertRuleKind;
  metric?: AlertMetric;
  comparator?: MetricComparator;
  threshold?: number;
  forConsecutive?: number;
  anomalySensitivity?: number;
}

export function createAlertRule(tenantId: string, input: CreateAlertRuleInput): Promise<AlertRule> {
  return request(tenantId, "POST", "/alert-rules", input);
}

export function updateAlertRule(
  tenantId: string,
  id: string,
  input: Partial<CreateAlertRuleInput>,
): Promise<AlertRule> {
  return request(tenantId, "PATCH", `/alert-rules/${id}`, input);
}

export function deleteAlertRule(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/alert-rules/${id}`);
}

// ---- Alerts ----

export function listAlerts(tenantId: string, status?: string): Promise<Alert[]> {
  return request(tenantId, "GET", `/alerts${status ? `?status=${status}` : ""}`);
}

export function acknowledgeAlert(tenantId: string, id: string): Promise<Alert> {
  return request(tenantId, "PATCH", `/alerts/${id}/ack`);
}

export function resolveAlert(tenantId: string, id: string): Promise<Alert> {
  return request(tenantId, "PATCH", `/alerts/${id}/resolve`);
}

export function linkAlertTicket(tenantId: string, id: string, ticketId: string): Promise<Alert> {
  return request(tenantId, "PATCH", `/alerts/${id}/link_ticket`, { ticketId });
}

// ---- Agent tokens ----

export function listAgentTokens(tenantId: string): Promise<AgentToken[]> {
  return request(tenantId, "GET", "/agent-tokens");
}

export function createAgentToken(
  tenantId: string,
  input: { resourceId: string; label: string },
): Promise<AgentToken> {
  return request(tenantId, "POST", "/agent-tokens", input);
}

export function updateAgentToken(
  tenantId: string,
  id: string,
  input: { isEnabled?: boolean; label?: string },
): Promise<AgentToken> {
  return request(tenantId, "PATCH", `/agent-tokens/${id}`, input);
}

export function deleteAgentToken(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/agent-tokens/${id}`);
}

// ---- Cloud credentials ----

export function listCloudCredentials(tenantId: string): Promise<CloudCredential[]> {
  return request(tenantId, "GET", "/cloud-credentials");
}

export function createCloudCredential(
  tenantId: string,
  input: { provider: string; label: string; config: Record<string, unknown> },
): Promise<CloudCredential> {
  return request(tenantId, "POST", "/cloud-credentials", input);
}

export function deleteCloudCredential(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/cloud-credentials/${id}`);
}

// ---- Escalation policies ----

export function listEscalationPolicies(tenantId: string): Promise<EscalationPolicy[]> {
  return request(tenantId, "GET", "/escalation-policies");
}

export function createEscalationPolicy(
  tenantId: string,
  input: { name: string; steps: EscalationPolicy["steps"] },
): Promise<EscalationPolicy> {
  return request(tenantId, "POST", "/escalation-policies", input);
}

export function deleteEscalationPolicy(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/escalation-policies/${id}`);
}

// ---- On-call schedules ----

export function listOnCallSchedules(tenantId: string): Promise<OnCallSchedule[]> {
  return request(tenantId, "GET", "/on-call-schedules");
}

export function createOnCallSchedule(
  tenantId: string,
  input: { name: string; entries: OnCallSchedule["entries"] },
): Promise<OnCallSchedule> {
  return request(tenantId, "POST", "/on-call-schedules", input);
}

export function deleteOnCallSchedule(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/on-call-schedules/${id}`);
}

// ---- Notification templates ----

export function listNotificationTemplates(tenantId: string): Promise<NotificationTemplate[]> {
  return request(tenantId, "GET", "/notification-templates");
}

export function createNotificationTemplate(
  tenantId: string,
  input: { channel: string; eventType: string; body: string; subject?: string; isDefault?: boolean },
): Promise<NotificationTemplate> {
  return request(tenantId, "POST", "/notification-templates", input);
}

export function deleteNotificationTemplate(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/notification-templates/${id}`);
}

// ---- Downtime events ----

export function listDowntimeEvents(tenantId: string): Promise<DowntimeEvent[]> {
  return request(tenantId, "GET", "/downtime-events");
}

export function createDowntimeEvent(
  tenantId: string,
  input: { resourceId: string; reason: string; monitorId?: string },
): Promise<DowntimeEvent> {
  return request(tenantId, "POST", "/downtime-events", input);
}

export function endDowntimeEvent(tenantId: string, id: string): Promise<DowntimeEvent> {
  return request(tenantId, "PATCH", `/downtime-events/${id}/end`);
}

// ---- Monitoring dashboard ----

export function getMonitoringDashboardSummary(tenantId: string): Promise<MonitoringDashboardSummary> {
  return request(tenantId, "GET", "/monitoring/dashboard/summary");
}

export function getMonitoringDashboardTrends(tenantId: string, days = 14): Promise<DashboardTrendPoint[]> {
  return request(tenantId, "GET", `/monitoring/dashboard/trends?days=${days}`);
}

// ---- Disk-full forecasts ----

export interface DiskForecast {
  id: string;
  monitor_id: string;
  resource_id: string | null;
  resource_name: string | null;
  current_pct: string;
  rate_per_day: string;
  days_to_full: string;
  reason_text: string;
  status: string;
  updated_at: string;
}

export function listDiskForecasts(tenantId: string): Promise<DiskForecast[]> {
  return request(tenantId, "GET", "/monitoring/disk-forecasts");
}

export function dismissDiskForecast(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "PATCH", `/monitoring/disk-forecasts/${id}/dismiss`);
}

// ---- Status pages ----

export function listStatusPages(tenantId: string): Promise<StatusPage[]> {
  return request(tenantId, "GET", "/status-pages");
}

export function getStatusPage(tenantId: string, id: string): Promise<StatusPageDetail> {
  return request(tenantId, "GET", `/status-pages/${id}`);
}

export function createStatusPage(
  tenantId: string,
  input: { slug: string; title: string; description?: string; isPublic?: boolean },
): Promise<StatusPage> {
  return request(tenantId, "POST", "/status-pages", input);
}

export function updateStatusPage(
  tenantId: string,
  id: string,
  input: { title?: string; description?: string; isPublic?: boolean },
): Promise<StatusPage> {
  return request(tenantId, "PATCH", `/status-pages/${id}`, input);
}

export function deleteStatusPage(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/status-pages/${id}`);
}

export function addStatusPageMonitor(
  tenantId: string,
  statusPageId: string,
  input: { monitorId: string; displayName?: string; sortOrder?: number },
): Promise<void> {
  return request(tenantId, "POST", `/status-pages/${statusPageId}/monitors`, input);
}

export function removeStatusPageMonitor(tenantId: string, statusPageId: string, linkId: string): Promise<void> {
  return request(tenantId, "DELETE", `/status-pages/${statusPageId}/monitors/${linkId}`);
}

// Unauthenticated -- no X-Tenant-Id, matches the public/no-guard backend route.
export function getPublicStatus(slug: string): Promise<PublicStatus> {
  return publicRequest(`/public/status/${slug}`);
}

// ---- Log management ----

export function searchLogs(
  tenantId: string,
  query: { sourceId?: string; level?: string; q?: string; from?: string; to?: string; limit?: number },
): Promise<LogEntry[]> {
  const params = new URLSearchParams();
  if (query.sourceId) params.set("sourceId", query.sourceId);
  if (query.level) params.set("level", query.level);
  if (query.q) params.set("q", query.q);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.limit) params.set("limit", String(query.limit));
  const qs = params.toString();
  return request(tenantId, "GET", `/logs/search${qs ? `?${qs}` : ""}`);
}

export function listLogSources(tenantId: string): Promise<LogSource[]> {
  return request(tenantId, "GET", "/logs/sources");
}

export function createLogSource(tenantId: string, name: string): Promise<LogSource> {
  return request(tenantId, "POST", "/logs/sources", { name });
}

export function updateLogSource(
  tenantId: string,
  id: string,
  input: { name?: string; isActive?: boolean },
): Promise<LogSource> {
  return request(tenantId, "PATCH", `/logs/sources/${id}`, input);
}

export function deleteLogSource(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/logs/sources/${id}`);
}

export function listLogAlertRules(tenantId: string): Promise<LogAlertRule[]> {
  return request(tenantId, "GET", "/logs/alert-rules");
}

export interface CreateLogAlertRuleInput {
  logSourceId: string;
  name: string;
  matchQuery?: string;
  levelAtLeast?: string;
  windowSeconds?: number;
  threshold?: number;
}

export function createLogAlertRule(tenantId: string, input: CreateLogAlertRuleInput): Promise<LogAlertRule> {
  return request(tenantId, "POST", "/logs/alert-rules", input);
}

export function updateLogAlertRule(
  tenantId: string,
  id: string,
  input: Partial<CreateLogAlertRuleInput & { isEnabled: boolean }>,
): Promise<LogAlertRule> {
  return request(tenantId, "PATCH", `/logs/alert-rules/${id}`, input);
}

export function deleteLogAlertRule(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/logs/alert-rules/${id}`);
}

// ---- APM ----

export function listApmIngestKeys(tenantId: string): Promise<ApmIngestKey[]> {
  return request(tenantId, "GET", "/apm/ingest-keys");
}

export function createApmIngestKey(tenantId: string, service: string): Promise<ApmIngestKey> {
  return request(tenantId, "POST", "/apm/ingest-keys", { service });
}

export function deleteApmIngestKey(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/apm/ingest-keys/${id}`);
}

export function listApmServices(tenantId: string): Promise<ApmServiceSummary[]> {
  return request(tenantId, "GET", "/apm/services");
}

export function getApmServiceStats(tenantId: string, service: string): Promise<ApmServiceStats> {
  return request(tenantId, "GET", `/apm/services/${encodeURIComponent(service)}/stats`);
}

export function getApmSlowestTraces(tenantId: string, service: string, limit = 10): Promise<ApmTrace[]> {
  return request(tenantId, "GET", `/apm/services/${encodeURIComponent(service)}/slowest-traces?limit=${limit}`);
}

export function getApmTrace(tenantId: string, id: string): Promise<{ trace: ApmTrace; spans: ApmSpan[] }> {
  return request(tenantId, "GET", `/apm/traces/${id}`);
}

// ---- RUM ----

export function listRumAppKeys(tenantId: string): Promise<RumAppKey[]> {
  return request(tenantId, "GET", "/rum/app-keys");
}

export function createRumAppKey(tenantId: string, appName: string): Promise<RumAppKey> {
  return request(tenantId, "POST", "/rum/app-keys", { appName });
}

export function deleteRumAppKey(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/rum/app-keys/${id}`);
}

export function listRumPages(tenantId: string): Promise<RumPageSummary[]> {
  return request(tenantId, "GET", "/rum/pages");
}

export function getRumPageStats(tenantId: string, page: string): Promise<RumPageStats> {
  return request(tenantId, "GET", `/rum/pages/${encodeURIComponent(page)}/stats`);
}

// ---- Network / SNMP ----

export interface CreateNetworkDeviceInput {
  name: string;
  host: string;
  snmpVersion?: string;
  community: string;
  port?: number;
}

export function listNetworkDevices(tenantId: string): Promise<NetworkDevice[]> {
  return request(tenantId, "GET", "/network-devices");
}

export function createNetworkDevice(tenantId: string, input: CreateNetworkDeviceInput): Promise<NetworkDevice> {
  return request(tenantId, "POST", "/network-devices", input);
}

export function updateNetworkDevice(
  tenantId: string,
  id: string,
  input: Partial<CreateNetworkDeviceInput & { isActive: boolean }>,
): Promise<NetworkDevice> {
  return request(tenantId, "PATCH", `/network-devices/${id}`, input);
}

export function deleteNetworkDevice(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/network-devices/${id}`);
}

export function getNetworkDeviceInterfaces(tenantId: string, deviceId: string): Promise<NetworkInterfaceSample[]> {
  return request(tenantId, "GET", `/network-devices/${deviceId}/interfaces`);
}

export function getNetworkInterfaceHistory(
  tenantId: string,
  deviceId: string,
  ifIndex: number,
  limit = 30,
): Promise<NetworkInterfaceSample[]> {
  return request(tenantId, "GET", `/network-devices/${deviceId}/interfaces/${ifIndex}/history?limit=${limit}`);
}
