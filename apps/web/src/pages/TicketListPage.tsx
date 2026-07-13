import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError, createTicket, listTickets } from "../lib/apiClient";
import { relativeTime } from "../lib/relativeTime";
import { useTenant } from "../lib/tenant";
import type { Ticket, TicketPriority, TicketStatus } from "../types/ticket";

const STATUSES: TicketStatus[] = ["new", "open", "pending", "resolved", "closed"];
const PRIORITIES: TicketPriority[] = ["low", "medium", "high", "urgent"];

export default function TicketListPage() {
  const { tenantId } = useTenant();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<TicketStatus | "">("");
  const [priority, setPriority] = useState<TicketPriority | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showNewForm, setShowNewForm] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newContactName, setNewContactName] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [creating, setCreating] = useState(false);

  const load = () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    listTickets(tenantId, {
      status: status || undefined,
      priority: priority || undefined,
    })
      .then((res) => {
        setTickets(res.items);
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load tickets"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tenantId, status, priority]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId) return;
    setCreating(true);
    setError(null);
    createTicket(tenantId, {
      subject: newSubject,
      contact: { name: newContactName, email: newContactEmail },
      source: "web_form",
    })
      .then(() => {
        setNewSubject("");
        setNewContactName("");
        setNewContactEmail("");
        setShowNewForm(false);
        load();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create ticket"))
      .finally(() => setCreating(false));
  };

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to load tickets.</p>;
  }

  return (
    <div>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value as TicketStatus | "")}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority | "")}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setShowNewForm((v) => !v)}>
          {showNewForm ? "Cancel" : "New ticket"}
        </button>
      </div>

      {showNewForm && (
        <form className="new-ticket-form" onSubmit={handleCreate}>
          <input placeholder="Subject" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} required />
          <input
            placeholder="Contact name"
            value={newContactName}
            onChange={(e) => setNewContactName(e.target.value)}
            required
          />
          <input
            type="email"
            placeholder="Contact email"
            value={newContactEmail}
            onChange={(e) => setNewContactEmail(e.target.value)}
            required
          />
          <button type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create"}
          </button>
        </form>
      )}

      {error && <p className="error">{error}</p>}
      {loading && <p>Loading…</p>}

      {!loading && tickets.length === 0 && <p className="hint">No tickets found.</p>}

      {tickets.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Subject</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr key={ticket.id}>
                <td>{ticket.ticket_number}</td>
                <td>
                  <Link to={`/tickets/${ticket.id}`}>{ticket.subject}</Link>
                </td>
                <td>
                  <span className={`badge status-${ticket.status}`}>{ticket.status}</span>
                </td>
                <td>
                  <span className={`badge priority-${ticket.priority}`}>{ticket.priority}</span>
                </td>
                <td title={new Date(ticket.created_at).toLocaleString()}>{relativeTime(ticket.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tickets.length > 0 && (
        <p className="hint">
          Showing {tickets.length} of {total}
        </p>
      )}
    </div>
  );
}
