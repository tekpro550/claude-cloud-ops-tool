import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  addTicketMessage,
  ApiError,
  getTicket,
  listAgents,
  listGroups,
  listTicketMessages,
  listTicketTypes,
  updateTicket,
  type UpdateTicketInput,
} from "../lib/apiClient";
import { dueLabel, relativeTime } from "../lib/relativeTime";
import { useTenant } from "../lib/tenant";
import type { Agent, Group, Ticket, TicketMessage, TicketMessageType, TicketPriority, TicketStatus, TicketType } from "../types/ticket";

const STATUSES: TicketStatus[] = ["new", "open", "pending", "resolved", "closed"];
const PRIORITIES: TicketPriority[] = ["low", "medium", "high", "urgent"];
const MESSAGE_TYPES: TicketMessageType[] = ["reply", "note", "forward"];

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { tenantId } = useTenant();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [messageType, setMessageType] = useState<TicketMessageType>("note");
  const [messageBody, setMessageBody] = useState("");
  const [posting, setPosting] = useState(false);

  const load = () => {
    if (!tenantId || !id) return;
    setLoading(true);
    setError(null);
    Promise.all([getTicket(tenantId, id), listTicketMessages(tenantId, id)])
      .then(([ticketRes, messagesRes]) => {
        setTicket(ticketRes);
        setMessages(messagesRes);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load ticket"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tenantId, id]);

  useEffect(() => {
    if (!tenantId) return;
    Promise.all([listGroups(tenantId), listAgents(tenantId), listTicketTypes(tenantId)])
      .then(([groupsRes, agentsRes, typesRes]) => {
        setGroups(groupsRes);
        setAgents(agentsRes);
        setTicketTypes(typesRes);
      })
      .catch(() => {
        // Reference data is only needed to populate dropdown options; a
        // failure here shouldn't block viewing/editing the ticket itself.
      });
  }, [tenantId]);

  const handlePropertyChange = (field: keyof UpdateTicketInput, value: string) => {
    if (!tenantId || !id) return;
    setSaving(true);
    setError(null);
    updateTicket(tenantId, id, { [field]: value })
      .then(setTicket)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update ticket"))
      .finally(() => setSaving(false));
  };

  const handleAddMessage = (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId || !id || !messageBody.trim()) return;
    setPosting(true);
    setError(null);
    // No auth yet, so there's no real agent identity to attribute this to —
    // authorType is fixed to "system" rather than pretending it's a
    // specific logged-in agent (see lib/tenant.tsx).
    addTicketMessage(tenantId, id, { type: messageType, authorType: "system", body: messageBody })
      .then(() => {
        setMessageBody("");
        return listTicketMessages(tenantId, id);
      })
      .then(setMessages)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to add message"))
      .finally(() => setPosting(false));
  };

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to load this ticket.</p>;
  }

  if (loading && !ticket) {
    return <p>Loading…</p>;
  }

  if (error && !ticket) {
    return <p className="error">{error}</p>;
  }

  if (!ticket) {
    return null;
  }

  return (
    <div>
      <p>
        <Link to="/">&larr; Back to tickets</Link>
      </p>

      <h2>
        #{ticket.ticket_number} {ticket.subject}
      </h2>

      {error && <p className="error">{error}</p>}

      <div className="properties-panel">
        <label>
          Status
          <select
            value={ticket.status}
            disabled={saving}
            onChange={(e) => handlePropertyChange("status", e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select
            value={ticket.priority}
            disabled={saving}
            onChange={(e) => handlePropertyChange("priority", e.target.value)}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Group
          <select
            value={ticket.group_id ?? ""}
            disabled={saving}
            onChange={(e) => handlePropertyChange("groupId", e.target.value)}
          >
            <option value="" disabled>
              Unassigned
            </option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Agent
          <select
            value={ticket.agent_id ?? ""}
            disabled={saving}
            onChange={(e) => handlePropertyChange("agentId", e.target.value)}
          >
            <option value="" disabled>
              Unassigned
            </option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ticket type
          <select
            value={ticket.ticket_type_id ?? ""}
            disabled={saving}
            onChange={(e) => handlePropertyChange("ticketTypeId", e.target.value)}
          >
            <option value="" disabled>
              None
            </option>
            {ticketTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <span className="hint">Source: {ticket.source}</span>
      </div>

      <div className="sla-panel">
        {ticket.first_response_at ? (
          <span className="hint">First response: {relativeTime(ticket.first_response_at)}</span>
        ) : (
          ticket.first_response_due_at && <SlaDueBadge label="First response" iso={ticket.first_response_due_at} />
        )}
        {ticket.resolved_at ? (
          <span className="hint">Resolved: {relativeTime(ticket.resolved_at)}</span>
        ) : (
          ticket.resolution_due_at && <SlaDueBadge label="Resolution" iso={ticket.resolution_due_at} />
        )}
      </div>

      <h3>Messages</h3>
      {messages.length === 0 && <p className="hint">No messages yet.</p>}
      <ul className="message-thread">
        {messages.map((message) => (
          <li key={message.id} className={`message message-${message.type}`}>
            <div className="message-meta">
              <strong>{message.type}</strong> by {message.author_type} · {new Date(message.created_at).toLocaleString()}
            </div>
            <div className="message-body">{message.body}</div>
          </li>
        ))}
      </ul>

      <form className="message-composer" onSubmit={handleAddMessage}>
        <select value={messageType} onChange={(e) => setMessageType(e.target.value as TicketMessageType)}>
          {MESSAGE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <textarea
          placeholder="Write a message…"
          value={messageBody}
          onChange={(e) => setMessageBody(e.target.value)}
          rows={3}
          required
        />
        <button type="submit" disabled={posting}>
          {posting ? "Posting…" : "Add message"}
        </button>
      </form>
    </div>
  );
}

function SlaDueBadge({ label, iso }: { label: string; iso: string }) {
  const { text, overdue } = dueLabel(iso);
  return <span className={`hint sla-due${overdue ? " overdue" : ""}`}>{label} {text}</span>;
}
