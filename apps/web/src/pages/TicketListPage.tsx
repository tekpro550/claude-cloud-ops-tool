import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, listAgents, listContacts, listGroups, listTickets, updateTicket } from "../lib/apiClient";
import { platformLabel, PLATFORMS } from "../lib/platform";
import { relativeTime } from "../lib/relativeTime";
import { formatTicketNumber } from "../lib/ticketNumber";
import { useTenant } from "../lib/tenant";
import type { Agent, Contact, Group, Ticket, TicketPlatform, TicketPriority, TicketStatus } from "../types/ticket";

const STATUSES: TicketStatus[] = ["new", "open", "pending", "resolved", "closed"];
const PRIORITIES: TicketPriority[] = ["low", "medium", "high", "urgent"];
const PAGE_SIZE = 25;

export default function TicketListPage() {
  const { tenantId } = useTenant();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<TicketStatus | "">("");
  const [priority, setPriority] = useState<TicketPriority | "">("");
  const [platform, setPlatform] = useState<TicketPlatform | "">("");
  const [groupId, setGroupId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [resolvedFrom, setResolvedFrom] = useState("");
  const [resolvedTo, setResolvedTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [groups, setGroups] = useState<Group[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      createdFrom: createdFrom ? new Date(createdFrom).toISOString() : undefined,
      createdTo: createdTo ? new Date(createdTo).toISOString() : undefined,
      resolvedFrom: resolvedFrom ? new Date(resolvedFrom).toISOString() : undefined,
      resolvedTo: resolvedTo ? new Date(resolvedTo).toISOString() : undefined,
      limit: PAGE_SIZE,
      offset,
    })
      .then((res) => {
        setTickets(res.items);
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load tickets"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tenantId, status, priority, platform, groupId, agentId, createdFrom, createdTo, resolvedFrom, resolvedTo, offset]);

  // Any filter change should snap back to page 1, not keep whatever offset
  // was scrolled to under the previous filter set.
  useEffect(() => {
    setOffset(0);
  }, [status, priority, platform, groupId, agentId, createdFrom, createdTo, resolvedFrom, resolvedTo]);

  useEffect(() => {
    if (!tenantId) return;
    Promise.all([listGroups(tenantId), listAgents(tenantId), listContacts(tenantId)])
      .then(([groupsRes, agentsRes, contactsRes]) => {
        setGroups(groupsRes);
        setAgents(agentsRes);
        setContacts(contactsRes);
      })
      .catch(() => {
        // Reference data only powers the filter dropdowns and the
        // contact/agent columns; a failure here shouldn't block the list.
      });
  }, [tenantId]);

  const contactNameById = new Map(contacts.map((c) => [c.id, c.name]));

  const patchLocal = (id: string, changes: Partial<Ticket>) => {
    setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, ...changes } : t)));
  };

  const handleInlineChange = <K extends keyof Ticket>(
    ticket: Ticket,
    field: K,
    value: string,
    input: Record<string, string>,
  ) => {
    if (!tenantId) return;
    patchLocal(ticket.id, { [field]: value } as Partial<Ticket>);
    updateTicket(tenantId, ticket.id, input).catch((err) => {
      setError(err instanceof ApiError ? err.message : "Failed to update ticket");
      load();
    });
  };

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to load tickets.</p>;
  }

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + PAGE_SIZE, total);

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
        <Link to="/tickets/new">
          <button type="button">New ticket</button>
        </Link>
      </div>

      <div className="toolbar toolbar-dates">
        <label className="date-filter">
          Created from
          <input type="date" value={createdFrom} onChange={(e) => setCreatedFrom(e.target.value)} />
        </label>
        <label className="date-filter">
          to
          <input type="date" value={createdTo} onChange={(e) => setCreatedTo(e.target.value)} />
        </label>
        <label className="date-filter">
          Resolved from
          <input type="date" value={resolvedFrom} onChange={(e) => setResolvedFrom(e.target.value)} />
        </label>
        <label className="date-filter">
          to
          <input type="date" value={resolvedTo} onChange={(e) => setResolvedTo(e.target.value)} />
        </label>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p>Loading…</p>}

      {!loading && tickets.length === 0 && <p className="hint">No tickets found.</p>}

      {tickets.length > 0 && (
        <div className="ticket-table-wrap">
          <table className="ticket-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Group</th>
                <th>Agent</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id}>
                  <td className="ticket-table-number">{formatTicketNumber(ticket)}</td>
                  <td className="ticket-table-subject">
                    <Link to={`/tickets/${ticket.id}`} title={ticket.subject}>
                      {ticket.subject}
                    </Link>
                    <div className="hint">{contactNameById.get(ticket.contact_id) ?? ""}</div>
                  </td>
                  <td>
                    <select
                      className={`inline-select status-${ticket.status}`}
                      value={ticket.status}
                      onChange={(e) =>
                        handleInlineChange(ticket, "status", e.target.value, { status: e.target.value as TicketStatus })
                      }
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className={`inline-select priority-${ticket.priority}`}
                      value={ticket.priority}
                      onChange={(e) =>
                        handleInlineChange(ticket, "priority", e.target.value, {
                          priority: e.target.value as TicketPriority,
                        })
                      }
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="inline-select"
                      value={ticket.group_id ?? ""}
                      onChange={(e) =>
                        handleInlineChange(ticket, "group_id", e.target.value, { groupId: e.target.value || undefined })
                      }
                    >
                      <option value="">—</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="inline-select"
                      value={ticket.agent_id ?? ""}
                      onChange={(e) =>
                        handleInlineChange(ticket, "agent_id", e.target.value, { agentId: e.target.value || undefined })
                      }
                    >
                      <option value="">Unassigned</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="hint" title={new Date(ticket.created_at).toLocaleString()}>
                    {relativeTime(ticket.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > 0 && (
        <div className="ticket-pager">
          <span className="hint">
            Showing {rangeStart}–{rangeEnd} of {total}
          </span>
          <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            Prev
          </button>
          <button type="button" disabled={rangeEnd >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
