import { request } from "./apiClient";
import type {
  AgentToken,
  Alert,
  AlertRule,
  CloudCredential,
  DowntimeEvent,
  EscalationPolicy,
  FleetSummaryItem,
  Monitor,
  MonitoringDashboardSummary,
  NotificationTemplate,
  OnCallSchedule,
  Resource,
  ResourceDashboard,
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

// ---- Alert rules ----

export function listAlertRules(tenantId: string): Promise<AlertRule[]> {
  return request(tenantId, "GET", "/alert-rules");
}

export function createAlertRule(
  tenantId: string,
  input: { monitorId: string; severity?: string; escalationPolicyId?: string },
): Promise<AlertRule> {
  return request(tenantId, "POST", "/alert-rules", input);
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
