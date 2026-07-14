import type {
  Agent,
  CannedResponse,
  DashboardSlaSummary,
  DashboardSummary,
  DashboardTrendPoint,
  Group,
  NeedsAttentionItem,
  SetupStatus,
  Ticket,
  TicketList,
  TicketMessage,
  TicketMessageAuthorType,
  TicketMessageType,
  TicketPriority,
  TicketStatus,
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
}

export function listTickets(tenantId: string, filters: ListTicketsFilters = {}): Promise<TicketList> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.priority) params.set("priority", filters.priority);
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
}

export function createTicket(tenantId: string, input: CreateTicketInput): Promise<Ticket> {
  return request(tenantId, "POST", "/tickets", input);
}

export interface UpdateTicketInput {
  status?: TicketStatus;
  priority?: TicketPriority;
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
