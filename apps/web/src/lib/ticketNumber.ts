import type { Ticket } from "../types/ticket";

/**
 * Display-only formatting: "YYYY-MM-NNN" from the ticket's own creation
 * month and its raw per-tenant sequence number. The underlying
 * ticket_number stays a plain lifetime-incrementing integer in the
 * database/API (used for uniqueness, ordering, and email-intake matching) --
 * it never resets month to month, so this is purely presentational, not a
 * new numbering scheme. Sequence is zero-padded to at least 3 digits and
 * overflows naturally past 999 (1000, 1001, ...) rather than truncating.
 */
export function formatTicketNumber(ticket: Pick<Ticket, "created_at" | "ticket_number">): string {
  const created = new Date(ticket.created_at);
  const year = created.getFullYear();
  const month = String(created.getMonth() + 1).padStart(2, "0");
  const sequence = String(ticket.ticket_number).padStart(3, "0");
  return `${year}-${month}-${sequence}`;
}
