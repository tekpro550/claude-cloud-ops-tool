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
  Ticket,
  TicketActivity,
  TicketList,
  TicketMessage,
  TicketMessageAuthorType,
  TicketMessageType,
  TicketPlatform,
  TicketPriority,
  TicketStatus,
  TicketTimelineItem,
  TicketTimeLogList,
  TicketTodo,
  TicketType,
} from "../types/ticket";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api/v1";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(tenantId: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-Id": tenantId,
    },
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
}

export function listTickets(tenantId: string, filters: ListTicketsFilters = {}): Promise<TicketList> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.platform) params.set("platform", filters.platform);
  if (filters.groupId) params.set("groupId", filters.groupId);
  if (filters.agentId) params.set("agentId", filters.agentId);
  const query = params.toString();
  return request(tenantId, "GET", `/tickets${query ? `?${query}` : ""}`);
}

export function getTicket(tenantId: string, id: string): Promise<Ticket> {
  return request(tenantId, "GET", `/tickets/${id}`);
}

export interface CreateTicketInput {
  subject: string;
  contact: { name: string; email: string };
  source: "web_form";
  platform?: TicketPlatform;
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
}

export function updateTicket(tenantId: string, id: string, input: UpdateTicketInput): Promise<Ticket> {
  return request(tenantId, "PATCH", `/tickets/${id}`, input);
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
