export type TicketStatus = "new" | "open" | "pending" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";

export interface PortalTicket {
  id: string;
  ticket_number: number;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  created_at: string;
  updated_at: string;
}

export interface PortalTicketMessage {
  id: string;
  type: "reply" | "note" | "forward";
  author_type: "agent" | "contact" | "system";
  body: string;
  created_at: string;
}

export interface PortalTicketDetail extends PortalTicket {
  messages: PortalTicketMessage[];
}

export interface PortalContact {
  id: string;
  name: string;
  email: string;
}

export interface PortalLoginResult {
  token: string;
  contact: PortalContact;
}

export interface Solution {
  id: string;
  title: string;
  body: string;
}

export type TicketSatisfactionRating = "happy" | "neutral" | "unhappy";

export interface TicketSatisfaction {
  id: string;
  ticket_id: string;
  contact_id: string;
  rating: TicketSatisfactionRating;
  comment: string | null;
  rated_at: string;
}
