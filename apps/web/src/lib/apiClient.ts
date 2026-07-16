import type {
  Agent,
  AutomationAction,
  AutomationCondition,
  AutomationRule,
  AutomationTrigger,
  CannedResponse,
  CannedResponseFolder,
  Company,
  Contact,
  CsatSummary,
  DashboardActivityItem,
  DashboardSlaSummary,
  DashboardSummary,
  DashboardTrendPoint,
  Group,
  NeedsAttentionItem,
  Scenario,
  SearchResults,
  SearchScope,
  SetupStatus,
  SlaPolicy,
  Solution,
  Ticket,
  TicketActivity,
  TicketAttachment,
  TicketList,
  TicketMessage,
  TicketMessageAuthorType,
  TicketMessageType,
  TicketPlatform,
  TicketPresenceEntry,
  TicketPriority,
  TicketSatisfactionEntry,
  TicketStatus,
  TicketTimelineItem,
  TicketTimeLogList,
  TicketTodo,
  TicketType,
  TicketView,
} from "../types/ticket";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api/v1";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Set by AuthProvider on login/logout. Kept as a module-level variable rather
// than threaded through every one of the ~40 API functions below -- once set,
// every request attaches it, and the backend guard prefers a valid Bearer
// token over X-Tenant-Id when both are present.
let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export async function request<T>(tenantId: string, method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Tenant-Id": tenantId,
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const message = payload?.message ?? res.statusText;
    throw new ApiError(Array.isArray(message) ? message.join(", ") : message, res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return res.json();
}

export interface ListTicketsFilters {
  status?: TicketStatus;
  priority?: TicketPriority;
  platform?: TicketPlatform;
  groupId?: string;
  agentId?: string;
  tag?: string;
  unassigned?: boolean;
  overdue?: boolean;
  createdFrom?: string;
  createdTo?: string;
  resolvedFrom?: string;
  resolvedTo?: string;
  limit?: number;
  offset?: number;
}

export function listTickets(tenantId: string, filters: ListTicketsFilters = {}): Promise<TicketList> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.platform) params.set("platform", filters.platform);
  if (filters.groupId) params.set("groupId", filters.groupId);
  if (filters.agentId) params.set("agentId", filters.agentId);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.unassigned) params.set("unassigned", "true");
  if (filters.overdue) params.set("overdue", "true");
  if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
  if (filters.createdTo) params.set("createdTo", filters.createdTo);
  if (filters.resolvedFrom) params.set("resolvedFrom", filters.resolvedFrom);
  if (filters.resolvedTo) params.set("resolvedTo", filters.resolvedTo);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined) params.set("offset", String(filters.offset));
  const query = params.toString();
  return request(tenantId, "GET", `/tickets${query ? `?${query}` : ""}`);
}

export function getTicket(tenantId: string, id: string): Promise<Ticket> {
  return request(tenantId, "GET", `/tickets/${id}`);
}

export interface CreateTicketInput {
  subject: string;
  contactId?: string;
  contact?: { name: string; email: string };
  source: "web_form" | "agent_outbound";
  ticketTypeId?: string;
  groupId?: string;
  agentId?: string;
  priority?: TicketPriority;
  platform?: TicketPlatform;
  tags?: string[];
  customFields?: Record<string, unknown>;
}

export function createTicket(tenantId: string, input: CreateTicketInput): Promise<Ticket> {
  return request(tenantId, "POST", "/tickets", input);
}

export interface ComposeOutboundInput {
  contactId?: string;
  contact?: { name: string; email: string };
  subject: string;
  body: string;
  groupId?: string;
  agentId?: string;
}

export function composeOutbound(tenantId: string, input: ComposeOutboundInput): Promise<Ticket> {
  return request(tenantId, "POST", "/tickets/compose-outbound", input);
}

export function search(tenantId: string, q: string, scope: SearchScope = "all"): Promise<SearchResults> {
  const params = new URLSearchParams({ q, scope });
  return request(tenantId, "GET", `/search?${params.toString()}`);
}

export interface UpdateTicketInput {
  status?: TicketStatus;
  priority?: TicketPriority;
  platform?: TicketPlatform;
  groupId?: string;
  agentId?: string;
  ticketTypeId?: string;
  tags?: string[];
  customFields?: Record<string, unknown>;
}

export function updateTicket(tenantId: string, id: string, input: UpdateTicketInput): Promise<Ticket> {
  return request(tenantId, "PATCH", `/tickets/${id}`, input);
}

export function listTicketTags(tenantId: string): Promise<string[]> {
  return request(tenantId, "GET", "/tickets/tags");
}

export function getTicketByNumber(tenantId: string, ticketNumber: number): Promise<Ticket> {
  return request(tenantId, "GET", `/tickets/by-number/${ticketNumber}`);
}

export function mergeTickets(tenantId: string, primaryId: string, sourceTicketIds: string[]): Promise<Ticket> {
  return request(tenantId, "POST", `/tickets/${primaryId}/merge`, { sourceTicketIds });
}

export type TicketLinkRelation = "related" | "parent" | "child";
export type TicketLinkType = "related" | "parent_of" | "child_of";

export interface LinkedTicket {
  linkId: string;
  relation: TicketLinkRelation;
  ticketId: string;
  ticketNumber: number;
  subject: string;
  status: string;
}

export function listTicketLinks(tenantId: string, ticketId: string): Promise<LinkedTicket[]> {
  return request(tenantId, "GET", `/tickets/${ticketId}/links`);
}

export function createTicketLink(tenantId: string, ticketId: string, toTicketNumber: number, linkType: TicketLinkType): Promise<unknown> {
  return request(tenantId, "POST", `/tickets/${ticketId}/links`, { toTicketNumber, linkType });
}

export function deleteTicketLink(tenantId: string, ticketId: string, linkId: string): Promise<void> {
  return request(tenantId, "DELETE", `/tickets/${ticketId}/links/${linkId}`);
}

export type CustomFieldType = "text" | "number" | "dropdown" | "checkbox" | "date";

export interface CustomFieldDef {
  id: string;
  key: string;
  label: string;
  field_type: CustomFieldType;
  options: string[];
  is_required: boolean;
  is_active: boolean;
  position: number;
}

export interface CreateCustomFieldInput {
  key: string;
  label: string;
  fieldType: CustomFieldType;
  options?: string[];
  isRequired?: boolean;
  position?: number;
}

export interface UpdateCustomFieldInput {
  label?: string;
  options?: string[];
  isRequired?: boolean;
  isActive?: boolean;
  position?: number;
}

export function listCustomFields(tenantId: string): Promise<CustomFieldDef[]> {
  return request(tenantId, "GET", "/ticket-custom-fields");
}

export function createCustomField(tenantId: string, input: CreateCustomFieldInput): Promise<CustomFieldDef> {
  return request(tenantId, "POST", "/ticket-custom-fields", input);
}

export function updateCustomField(tenantId: string, id: string, input: UpdateCustomFieldInput): Promise<CustomFieldDef> {
  return request(tenantId, "PATCH", `/ticket-custom-fields/${id}`, input);
}

export function deleteCustomField(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/ticket-custom-fields/${id}`);
}

export interface AuditLogEntry {
  id: string;
  actor_user_id: string | null;
  actor_label: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface AuditLogList {
  items: AuditLogEntry[];
  total: number;
}

export function listAuditLog(tenantId: string, limit = 50): Promise<AuditLogList> {
  const qs = new URLSearchParams({ limit: String(limit) }).toString();
  return request(tenantId, "GET", `/admin/audit-log?${qs}`);
}

export function listGroups(tenantId: string): Promise<Group[]> {
  return request(tenantId, "GET", "/groups");
}

export function listAgents(tenantId: string): Promise<Agent[]> {
  return request(tenantId, "GET", "/agents");
}

export function listTicketTypes(tenantId: string): Promise<TicketType[]> {
  return request(tenantId, "GET", "/ticket-types");
}

export function listTicketMessages(tenantId: string, ticketId: string): Promise<TicketMessage[]> {
  return request(tenantId, "GET", `/tickets/${ticketId}/messages`);
}

export function listTicketActivities(tenantId: string, ticketId: string): Promise<TicketActivity[]> {
  return request(tenantId, "GET", `/tickets/${ticketId}/activities`);
}

export function getTicketTimeline(tenantId: string, ticketId: string): Promise<TicketTimelineItem[]> {
  return request(tenantId, "GET", `/tickets/${ticketId}/timeline`);
}

export function listTicketAttachments(tenantId: string, ticketId: string): Promise<TicketAttachment[]> {
  return request(tenantId, "GET", `/tickets/${ticketId}/attachments`);
}

// Multipart upload -- can't go through request(), which always sends
// Content-Type: application/json.
export async function uploadTicketAttachment(
  tenantId: string,
  ticketId: string,
  messageId: string,
  file: File,
): Promise<TicketAttachment> {
  const formData = new FormData();
  formData.append("file", file);
  const headers: Record<string, string> = { "X-Tenant-Id": tenantId };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  const res = await fetch(`${API_BASE_URL}/tickets/${ticketId}/messages/${messageId}/attachments`, {
    method: "POST",
    headers,
    body: formData,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    const message = payload?.message ?? res.statusText;
    throw new ApiError(Array.isArray(message) ? message.join(", ") : message, res.status);
  }
  return res.json();
}

// Downloading needs the same auth headers as any other request, so a plain
// <a href> won't work -- fetch the bytes and trigger a browser download via
// a temporary blob URL instead.
export async function downloadTicketAttachment(tenantId: string, ticketId: string, attachment: TicketAttachment): Promise<void> {
  const headers: Record<string, string> = { "X-Tenant-Id": tenantId };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }
  const res = await fetch(`${API_BASE_URL}/tickets/${ticketId}/attachments/${attachment.id}/download`, { headers });
  if (!res.ok) {
    throw new ApiError("Failed to download attachment", res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = attachment.file_name;
  link.click();
  URL.revokeObjectURL(url);
}

export interface AddTicketMessageInput {
  type: TicketMessageType;
  authorType: TicketMessageAuthorType;
  body: string;
}

export function addTicketMessage(tenantId: string, ticketId: string, input: AddTicketMessageInput): Promise<TicketMessage> {
  return request(tenantId, "POST", `/tickets/${ticketId}/messages`, input);
}

export function listCannedResponses(tenantId: string): Promise<CannedResponse[]> {
  return request(tenantId, "GET", "/canned-responses");
}

export function listTicketTodos(tenantId: string, ticketId: string): Promise<TicketTodo[]> {
  return request(tenantId, "GET", `/tickets/${ticketId}/todos`);
}

export function createTicketTodo(tenantId: string, ticketId: string, body: string): Promise<TicketTodo> {
  return request(tenantId, "POST", `/tickets/${ticketId}/todos`, { body });
}

export function updateTicketTodo(
  tenantId: string,
  ticketId: string,
  todoId: string,
  input: { isDone?: boolean; body?: string },
): Promise<TicketTodo> {
  return request(tenantId, "PATCH", `/tickets/${ticketId}/todos/${todoId}`, input);
}

export function deleteTicketTodo(tenantId: string, ticketId: string, todoId: string): Promise<void> {
  return request(tenantId, "DELETE", `/tickets/${ticketId}/todos/${todoId}`);
}

export function listTicketTimeLogs(tenantId: string, ticketId: string): Promise<TicketTimeLogList> {
  return request(tenantId, "GET", `/tickets/${ticketId}/time-logs`);
}

export function createTicketTimeLog(
  tenantId: string,
  ticketId: string,
  input: { minutes: number; note?: string; agentId?: string },
): Promise<TicketTimeLogList["items"][number]> {
  return request(tenantId, "POST", `/tickets/${ticketId}/time-logs`, input);
}

export function deleteTicketTimeLog(tenantId: string, ticketId: string, logId: string): Promise<void> {
  return request(tenantId, "DELETE", `/tickets/${ticketId}/time-logs/${logId}`);
}

export function getDashboardSummary(tenantId: string): Promise<DashboardSummary> {
  return request(tenantId, "GET", "/dashboard/summary");
}

export function getDashboardTrends(tenantId: string, days = 14): Promise<DashboardTrendPoint[]> {
  return request(tenantId, "GET", `/dashboard/trends?days=${days}`);
}

export function getDashboardSlaSummary(tenantId: string): Promise<DashboardSlaSummary> {
  return request(tenantId, "GET", "/dashboard/sla-summary");
}

export function getNeedsAttention(tenantId: string): Promise<{ items: NeedsAttentionItem[] }> {
  return request(tenantId, "GET", "/dashboard/needs-attention");
}

export function getDashboardActivity(tenantId: string, limit = 30): Promise<DashboardActivityItem[]> {
  return request(tenantId, "GET", `/dashboard/activity?limit=${limit}`);
}

export function getSetupStatus(tenantId: string): Promise<SetupStatus> {
  return request(tenantId, "GET", "/admin/setup-status");
}

// ---- Groups ----

export function createGroup(tenantId: string, input: { name: string; description?: string }): Promise<Group> {
  return request(tenantId, "POST", "/groups", input);
}

export function updateGroup(tenantId: string, id: string, input: { name?: string; description?: string }): Promise<Group> {
  return request(tenantId, "PATCH", `/groups/${id}`, input);
}

export function deleteGroup(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/groups/${id}`);
}

// ---- Agents ----

export function createAgent(
  tenantId: string,
  input: { name: string; email: string; groupIds?: string[] },
): Promise<Agent> {
  return request(tenantId, "POST", "/agents", input);
}

export function updateAgent(
  tenantId: string,
  id: string,
  input: { name?: string; email?: string; isActive?: boolean; groupIds?: string[] },
): Promise<Agent> {
  return request(tenantId, "PATCH", `/agents/${id}`, input);
}

// ---- Ticket types ----

export function createTicketType(
  tenantId: string,
  input: { name: string; defaultGroupId?: string; defaultSlaPolicyId?: string },
): Promise<TicketType> {
  return request(tenantId, "POST", "/ticket-types", input);
}

export function updateTicketType(
  tenantId: string,
  id: string,
  input: { name?: string; defaultGroupId?: string; defaultSlaPolicyId?: string },
): Promise<TicketType> {
  return request(tenantId, "PATCH", `/ticket-types/${id}`, input);
}

export function deleteTicketType(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/ticket-types/${id}`);
}

// ---- SLA policies ----

export function listSlaPolicies(tenantId: string): Promise<SlaPolicy[]> {
  return request(tenantId, "GET", "/sla-policies");
}

export function createSlaPolicy(
  tenantId: string,
  input: { name: string; firstResponseTargetMinutes: number; resolutionTargetMinutes: number; businessHoursOnly?: boolean },
): Promise<SlaPolicy> {
  return request(tenantId, "POST", "/sla-policies", input);
}

export function updateSlaPolicy(
  tenantId: string,
  id: string,
  input: { name?: string; firstResponseTargetMinutes?: number; resolutionTargetMinutes?: number; businessHoursOnly?: boolean },
): Promise<SlaPolicy> {
  return request(tenantId, "PATCH", `/sla-policies/${id}`, input);
}

export function deleteSlaPolicy(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/sla-policies/${id}`);
}

// ---- Automation rules ----

export function listAutomationRules(tenantId: string): Promise<AutomationRule[]> {
  return request(tenantId, "GET", "/automation-rules");
}

export function createAutomationRule(
  tenantId: string,
  input: {
    name: string;
    trigger: AutomationTrigger;
    position?: number;
    isActive?: boolean;
    timeTriggerMinutes?: number;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
  },
): Promise<AutomationRule> {
  return request(tenantId, "POST", "/automation-rules", input);
}

export function updateAutomationRule(
  tenantId: string,
  id: string,
  input: {
    name?: string;
    trigger?: AutomationTrigger;
    position?: number;
    isActive?: boolean;
    timeTriggerMinutes?: number;
    conditions?: AutomationCondition[];
    actions?: AutomationAction[];
  },
): Promise<AutomationRule> {
  return request(tenantId, "PATCH", `/automation-rules/${id}`, input);
}

export function deleteAutomationRule(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/automation-rules/${id}`);
}

// ---- Scenarios (one-click macros) ----

export function listScenarios(tenantId: string): Promise<Scenario[]> {
  return request(tenantId, "GET", "/scenarios");
}

export function createScenario(
  tenantId: string,
  input: { name: string; agentId?: string; actions: AutomationAction[] },
): Promise<Scenario> {
  return request(tenantId, "POST", "/scenarios", input);
}

export function updateScenario(
  tenantId: string,
  id: string,
  input: { name?: string; agentId?: string; actions?: AutomationAction[] },
): Promise<Scenario> {
  return request(tenantId, "PATCH", `/scenarios/${id}`, input);
}

export function deleteScenario(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/scenarios/${id}`);
}

export function applyScenario(tenantId: string, scenarioId: string, ticketId: string): Promise<Ticket> {
  return request(tenantId, "POST", `/scenarios/${scenarioId}/apply`, { ticketId });
}

// ---- Canned response folders ----

export function listCannedResponseFolders(tenantId: string): Promise<CannedResponseFolder[]> {
  return request(tenantId, "GET", "/canned-response-folders");
}

export function createCannedResponseFolder(
  tenantId: string,
  input: { name: string; agentId?: string },
): Promise<CannedResponseFolder> {
  return request(tenantId, "POST", "/canned-response-folders", input);
}

export function updateCannedResponseFolder(
  tenantId: string,
  id: string,
  input: { name?: string; agentId?: string },
): Promise<CannedResponseFolder> {
  return request(tenantId, "PATCH", `/canned-response-folders/${id}`, input);
}

export function deleteCannedResponseFolder(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/canned-response-folders/${id}`);
}

// ---- Canned responses (create/update/delete; list already defined above) ----

export function createCannedResponse(
  tenantId: string,
  input: { title: string; body: string; folderId?: string },
): Promise<CannedResponse> {
  return request(tenantId, "POST", "/canned-responses", input);
}

export function updateCannedResponse(
  tenantId: string,
  id: string,
  input: { title?: string; body?: string; folderId?: string },
): Promise<CannedResponse> {
  return request(tenantId, "PATCH", `/canned-responses/${id}`, input);
}

export function deleteCannedResponse(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/canned-responses/${id}`);
}

// ---- Contacts ----

export function listContacts(tenantId: string, search?: string, needsAction?: boolean): Promise<Contact[]> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (needsAction) params.set("needsAction", "true");
  const query = params.toString();
  return request(tenantId, "GET", `/contacts${query ? `?${query}` : ""}`);
}

export function getContact(tenantId: string, id: string): Promise<Contact> {
  return request(tenantId, "GET", `/contacts/${id}`);
}

export function createContact(
  tenantId: string,
  input: { name: string; email?: string; phone?: string; companyId?: string },
): Promise<Contact> {
  return request(tenantId, "POST", "/contacts", input);
}

export function updateContact(
  tenantId: string,
  id: string,
  input: { name?: string; email?: string; phone?: string; companyId?: string },
): Promise<Contact> {
  return request(tenantId, "PATCH", `/contacts/${id}`, input);
}

// ---- Companies ----

export function listCompanies(tenantId: string): Promise<Company[]> {
  return request(tenantId, "GET", "/companies");
}

export function getCompany(tenantId: string, id: string): Promise<Company> {
  return request(tenantId, "GET", `/companies/${id}`);
}

export function createCompany(tenantId: string, input: { name: string; domain?: string }): Promise<Company> {
  return request(tenantId, "POST", "/companies", input);
}

export function updateCompany(
  tenantId: string,
  id: string,
  input: { name?: string; domain?: string },
): Promise<Company> {
  return request(tenantId, "PATCH", `/companies/${id}`, input);
}

export function deleteCompany(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/companies/${id}`);
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "agent" | "viewer";
}

export interface LoginResult {
  token: string;
  user: AuthUser;
}

export function login(tenantId: string, email: string, password: string): Promise<LoginResult> {
  return request(tenantId, "POST", "/auth/login", { email, password });
}

export function getCurrentUser(tenantId: string): Promise<AuthUser> {
  return request(tenantId, "GET", "/auth/me");
}

export function listSolutions(tenantId: string): Promise<Solution[]> {
  return request(tenantId, "GET", "/admin/solutions");
}

export function createSolution(
  tenantId: string,
  input: { title: string; body: string; isPublished?: boolean },
): Promise<Solution> {
  return request(tenantId, "POST", "/admin/solutions", input);
}

export function updateSolution(
  tenantId: string,
  id: string,
  input: { title?: string; body?: string; isPublished?: boolean },
): Promise<Solution> {
  return request(tenantId, "PATCH", `/admin/solutions/${id}`, input);
}

export function deleteSolution(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/admin/solutions/${id}`);
}

// ---- Ticket presence (collision detection) ----

export function heartbeatPresence(tenantId: string, ticketId: string, isTyping: boolean): Promise<void> {
  return request(tenantId, "POST", `/tickets/${ticketId}/presence`, { isTyping });
}

export function getPresence(tenantId: string, ticketId: string): Promise<TicketPresenceEntry[]> {
  return request(tenantId, "GET", `/tickets/${ticketId}/presence`);
}

// ---- Saved/custom ticket views ----

export function listTicketViews(tenantId: string): Promise<TicketView[]> {
  return request(tenantId, "GET", "/ticket-views");
}

export function createTicketView(
  tenantId: string,
  input: { name: string; filters: Record<string, unknown> },
): Promise<TicketView> {
  return request(tenantId, "POST", "/ticket-views", input);
}

export function deleteTicketView(tenantId: string, id: string): Promise<void> {
  return request(tenantId, "DELETE", `/ticket-views/${id}`);
}

// ---- CSAT ----

export function getTicketSatisfaction(tenantId: string, ticketId: string): Promise<TicketSatisfactionEntry | null> {
  return request(tenantId, "GET", `/tickets/${ticketId}/satisfaction`);
}

export function getCsatSummary(tenantId: string, days = 30): Promise<CsatSummary> {
  return request(tenantId, "GET", `/dashboard/csat-summary?days=${days}`);
}

// ---- Business hours (SLA working window) ----

export interface BusinessHours {
  startMinute: number;
  endMinute: number;
  days: number[];
  timezone: string;
}

export function getBusinessHours(tenantId: string): Promise<BusinessHours> {
  return request(tenantId, "GET", "/business-hours");
}

export function updateBusinessHours(tenantId: string, input: Partial<BusinessHours>): Promise<BusinessHours> {
  return request(tenantId, "PATCH", "/business-hours", input);
}
