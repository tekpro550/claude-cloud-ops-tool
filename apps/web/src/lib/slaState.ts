import type { Ticket } from "../types/ticket";

export type SlaState = "no_sla" | "pending" | "at_risk" | "breached" | "met";

const AT_RISK_WINDOW_MS = 1000 * 60 * 60 * 4;

/**
 * Mirrors the met/breached/pending buckets the dashboard SLA summary uses
 * (dashboard.service.ts) so a ticket's badge here always agrees with how
 * it's counted there, plus an "at risk" state (due soon, not yet breached)
 * that's only useful for a single-ticket badge, not an aggregate summary.
 */
export function ticketSlaState(
  ticket: Pick<Ticket, "sla_policy_id" | "resolved_at" | "resolution_due_at">,
): SlaState {
  if (!ticket.sla_policy_id || !ticket.resolution_due_at) return "no_sla";
  const dueAt = new Date(ticket.resolution_due_at).getTime();

  if (ticket.resolved_at) {
    return new Date(ticket.resolved_at).getTime() <= dueAt ? "met" : "breached";
  }

  const now = Date.now();
  if (now > dueAt) return "breached";
  if (dueAt - now < AT_RISK_WINDOW_MS) return "at_risk";
  return "pending";
}

export const SLA_STATE_LABELS: Record<SlaState, string> = {
  no_sla: "No SLA",
  pending: "On track",
  at_risk: "At risk",
  breached: "Overdue",
  met: "Met",
};
