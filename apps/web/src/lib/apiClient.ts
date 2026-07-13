import type {
  Agent,
  Group,
  Ticket,
  TicketList,
  TicketMessage,
  TicketMessageAuthorType,
  TicketMessageType,
  TicketPriority,
  TicketStatus,
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
