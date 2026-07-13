// Mirrors the raw Postgres row shape the API returns as-is (snake_case),
// per apps/api/src/modules/ticketing/tickets.service.ts. No camelCase
// mapping layer exists yet on the backend, so the frontend consumes exactly
// what comes back over the wire rather than inventing one.

export type TicketStatus = "new" | "open" | "pending" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketSource = "email" | "web_form" | "whatsapp" | "chat" | "api" | "alert";

export interface Ticket {
  id: string;
  tenant_id: string;
  ticket_number: number;
  legacy_ticket_number: number | null;
  subject: string;
  contact_id: string;
  ticket_type_id: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  group_id: string | null;
  agent_id: string | null;
  resource_id: string | null;
  sla_policy_id: string | null;
  first_response_due_at: string | null;
  first_response_at: string | null;
  resolution_due_at: string | null;
  resolved_at: string | null;
  source: TicketSource;
  created_at: string;
  updated_at: string;
}

export interface TicketList {
  items: Ticket[];
  total: number;
}

export type TicketMessageType = "reply" | "note" | "forward";
export type TicketMessageAuthorType = "agent" | "contact" | "system";

export interface TicketMessage {
  id: string;
  tenant_id: string;
  ticket_id: string;
  type: TicketMessageType;
  author_type: TicketMessageAuthorType;
  author_id: string | null;
  body: string;
  cc: string[];
  created_at: string;
}
