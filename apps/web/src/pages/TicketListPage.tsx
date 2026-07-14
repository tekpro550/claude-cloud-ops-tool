import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError, createTicket, listAgents, listGroups, listTickets } from "../lib/apiClient";
import { platformLabel, PLATFORMS } from "../lib/platform";
import { relativeTime } from "../lib/relativeTime";
import { formatTicketNumber } from "../lib/ticketNumber";
import { useTenant } from "../lib/tenant";
import type { Agent, Group, Ticket, TicketPlatform, TicketPriority, TicketStatus } from "../types/ticket";

const STATUSES: TicketStatus[] = ["new", "open", "pending", "resolved", "closed"];
const PRIORITIES: TicketPriority[] = ["low", "medium", "high", "urgent"];

export default function TicketListPage() {
  const { tenantId } = useTenant();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<TicketStatus | "">("");
  const [priority, setPriority] = useState<TicketPriority | "">("");
  const [platform, setPlatform] = useState<TicketPlatform | "">("");
  const [groupId, setGroupId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
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
      platform: platform || undefined,
      groupId: groupId || undefined,
      agentId: agentId || undefined,
    })
      .then((res) => {
        setTickets(res.items);
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load tickets"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tenantId, status, priority, platform, groupId, agentId]);

  useEffect(() => {
    if (!tenantId) return;
    Promise.all([listGroups(tenantId), listAgents(tenantId)])
      .then(([groupsRes, agentsRes]) => {
        setGroups(groupsRes);
        setAgents(agentsRes);
      })
      .catch(() => {
        // Reference data only powers the filter dropdowns and the agent
        // column; a failure here shouldn't block viewing the ticket list.
      });
  }, [tenantId]);

  const agentNameById = new Map(agents.map((a) => [a.id, a.name]));

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
        <select value={platform} onChange={(e) => setPlatform(e.target.value as TicketPlatform | "")}>
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {platformLabel(p)}
            </option>
          ))}
        </select>
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
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
              <th>Platform</th>
              <th>Agent</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr key={ticket.id}>
                <td>{formatTicketNumber(ticket)}</td>
                <td>
                  <Link to={`/tickets/${ticket.id}`}>{ticket.subject}</Link>
                </td>
                <td>
                  <span className={`badge status-${ticket.status}`}>{ticket.status}</span>
                </td>
                <td>
                  <span className={`badge priority-${ticket.priority}`}>{ticket.priority}</span>
                </td>
                <td className={ticket.platform ? undefined : "hint"}>{ticket.platform ? platformLabel(ticket.platform) : "—"}</td>
                <td className={ticket.agent_id ? undefined : "hint"}>
                  {ticket.agent_id ? (agentNameById.get(ticket.agent_id) ?? "Unknown agent") : "Unassigned"}
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
