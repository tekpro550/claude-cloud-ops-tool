import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  createTicketView,
  deleteTicketView,
  listAgents,
  listContacts,
  listGroups,
  listTicketViews,
  listTickets,
  updateTicket,
} from "../lib/apiClient";
import { avatarColor, initials } from "../lib/avatar";
import { platformLabel, PLATFORMS } from "../lib/platform";
import { relativeTime } from "../lib/relativeTime";
import { formatTicketNumber } from "../lib/ticketNumber";
import { useTenant } from "../lib/tenant";
import type { Agent, Contact, Group, Ticket, TicketPlatform, TicketPriority, TicketStatus, TicketView } from "../types/ticket";

const STATUSES: TicketStatus[] = ["new", "open", "pending", "resolved", "closed"];
const PRIORITIES: TicketPriority[] = ["low", "medium", "high", "urgent"];
const PAGE_SIZE = 25;

type ViewKey = "all" | "unassigned" | "urgent" | "overdue";

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "all", label: "All tickets" },
  { key: "unassigned", label: "Unassigned" },
  { key: "urgent", label: "Urgent" },
  { key: "overdue", label: "Overdue" },
];

export default function TicketListPage() {
  const { tenantId } = useTenant();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [view, setView] = useState<ViewKey>("all");
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAgentId, setBulkAgentId] = useState("");
  const [bulkStatus, setBulkStatus] = useState<TicketStatus | "">("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const [savedViews, setSavedViews] = useState<TicketView[]>([]);
  const [activeSavedViewId, setActiveSavedViewId] = useState<string | null>(null);
  const [savingViewForm, setSavingViewForm] = useState(false);
  const [newViewName, setNewViewName] = useState("");

  const load = () => {
    if (!tenantId) return;
    setLoading(true);
    setError(null);
    listTickets(tenantId, {
      status: status || undefined,
      priority: view === "urgent" ? "urgent" : priority || undefined,
      platform: platform || undefined,
      groupId: groupId || undefined,
      agentId: agentId || undefined,
      unassigned: view === "unassigned" || undefined,
      overdue: view === "overdue" || undefined,
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

  useEffect(load, [tenantId, view, status, priority, platform, groupId, agentId, createdFrom, createdTo, resolvedFrom, resolvedTo, offset]);

  // Any filter change should snap back to page 1, not keep whatever offset
  // was scrolled to under the previous filter set.
  useEffect(() => {
    setOffset(0);
    setSelected(new Set());
  }, [view, status, priority, platform, groupId, agentId, createdFrom, createdTo, resolvedFrom, resolvedTo]);

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

  const loadSavedViews = () => {
    if (!tenantId) return;
    listTicketViews(tenantId)
      .then(setSavedViews)
      .catch(() => {
        // Saved views are a convenience layer on top of the filter bar;
        // a failure here shouldn't block the ticket list itself.
      });
  };

  useEffect(loadSavedViews, [tenantId]);

  const currentFilters = () => ({
    status,
    priority,
    platform,
    groupId,
    agentId,
    createdFrom,
    createdTo,
    resolvedFrom,
    resolvedTo,
  });

  const applySavedView = (savedView: TicketView) => {
    const f = savedView.filters as Partial<ReturnType<typeof currentFilters>>;
    setView("all");
    setActiveSavedViewId(savedView.id);
    setStatus((f.status as TicketStatus) ?? "");
    setPriority((f.priority as TicketPriority) ?? "");
    setPlatform((f.platform as TicketPlatform) ?? "");
    setGroupId(f.groupId ?? "");
    setAgentId(f.agentId ?? "");
    setCreatedFrom(f.createdFrom ?? "");
    setCreatedTo(f.createdTo ?? "");
    setResolvedFrom(f.resolvedFrom ?? "");
    setResolvedTo(f.resolvedTo ?? "");
  };

  const selectStandardView = (key: ViewKey) => {
    setActiveSavedViewId(null);
    setView(key);
  };

  const handleSaveView = (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId || !newViewName.trim()) return;
    createTicketView(tenantId, { name: newViewName.trim(), filters: currentFilters() })
      .then((created) => {
        setNewViewName("");
        setSavingViewForm(false);
        loadSavedViews();
        setActiveSavedViewId(created.id);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to save view"));
  };

  const handleDeleteSavedView = (savedView: TicketView) => {
    if (!tenantId) return;
    deleteTicketView(tenantId, savedView.id)
      .then(() => {
        if (activeSavedViewId === savedView.id) {
          setActiveSavedViewId(null);
          setView("all");
        }
        loadSavedViews();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete view"));
  };

  const contactNameById = new Map(contacts.map((c) => [c.id, c.name]));
  const agentNameById = new Map(agents.map((a) => [a.id, a.name]));

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

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllOnPage = () => setSelected(new Set(tickets.map((t) => t.id)));
  const clearSelection = () => setSelected(new Set());

  const runBulkUpdate = async (input: Record<string, string>) => {
    if (!tenantId || selected.size === 0) return;
    setBulkBusy(true);
    try {
      await Promise.all([...selected].map((id) => updateTicket(tenantId, id, input)));
      clearSelection();
      setBulkAgentId("");
      setBulkStatus("");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Bulk update failed");
    } finally {
      setBulkBusy(false);
    }
  };

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to load tickets.</p>;
  }

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + PAGE_SIZE, total);

  return (
    <div>
      <div className="page-header">
        <h2>Tickets</h2>
        <Link to="/tickets/new">
          <button type="button" className="btn-primary">
            + New ticket
          </button>
        </Link>
      </div>

      <div className="view-tabs">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            className={`view-tab${!activeSavedViewId && view === v.key ? " view-tab-active" : ""}`}
            onClick={() => selectStandardView(v.key)}
          >
            {v.label}
          </button>
        ))}
        {savedViews.map((v) => (
          <span key={v.id} className={`view-tab view-tab-saved${activeSavedViewId === v.id ? " view-tab-active" : ""}`}>
            <button type="button" className="view-tab-saved-label" onClick={() => applySavedView(v)}>
              {v.name}
            </button>
            <button
              type="button"
              className="view-tab-saved-remove"
              aria-label={`Delete view ${v.name}`}
              onClick={() => handleDeleteSavedView(v)}
            >
              &times;
            </button>
          </span>
        ))}
        {savingViewForm ? (
          <form className="view-tab-save-form" onSubmit={handleSaveView}>
            <input
              autoFocus
              placeholder="View name"
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
            />
            <button type="submit" className="link-button">
              Save
            </button>
            <button type="button" className="link-button" onClick={() => setSavingViewForm(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="link-button view-tab-save-trigger" onClick={() => setSavingViewForm(true)}>
            + Save current filters
          </button>
        )}
      </div>

      <div className="filters-bar">
        <select value={status} onChange={(e) => setStatus(e.target.value as TicketStatus | "")}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {view !== "urgent" && (
          <select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority | "")}>
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
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
        {view !== "unassigned" && (
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">All agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
        <details>
          <summary className="link-button" style={{ display: "inline" }}>
            More filters
          </summary>
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
        </details>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p>Loading…</p>}

      {!loading && tickets.length === 0 && <p className="hint">No tickets found.</p>}

      {selected.size > 0 && (
        <div className="bulk-action-bar">
          <strong>{selected.size} selected</strong>
          <select
            value={bulkStatus}
            disabled={bulkBusy}
            onChange={(e) => {
              const value = e.target.value as TicketStatus | "";
              setBulkStatus(value);
              if (value) runBulkUpdate({ status: value });
            }}
          >
            <option value="">Set status…</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={bulkAgentId}
            disabled={bulkBusy}
            onChange={(e) => {
              const value = e.target.value;
              setBulkAgentId(value);
              if (value) runBulkUpdate({ agentId: value });
            }}
          >
            <option value="">Assign to…</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn-ghost btn-sm" onClick={clearSelection} disabled={bulkBusy}>
            Clear selection
          </button>
        </div>
      )}

      {tickets.length > 0 && (
        <>
          <button type="button" className="link-button" onClick={selected.size === tickets.length ? clearSelection : selectAllOnPage}>
            {selected.size === tickets.length ? "Deselect all" : `Select all ${tickets.length} on this page`}
          </button>

          <div className="ticket-row-list">
            {tickets.map((ticket) => {
              const contactName = contactNameById.get(ticket.contact_id) ?? "";
              return (
                <div key={ticket.id} className={`ticket-row priority-stripe-${ticket.priority}`}>
                  <input
                    type="checkbox"
                    className="ticket-row-checkbox"
                    checked={selected.has(ticket.id)}
                    onChange={() => toggleSelected(ticket.id)}
                    aria-label={`Select ticket ${formatTicketNumber(ticket)}`}
                  />
                  <span className="ticket-row-number">{formatTicketNumber(ticket)}</span>
                  <span className="avatar avatar-sm" style={{ background: avatarColor(contactName) }}>
                    {initials(contactName)}
                  </span>
                  <div className="ticket-row-main">
                    <Link to={`/tickets/${ticket.id}`} className="ticket-row-subject" title={ticket.subject}>
                      {ticket.subject}
                    </Link>
                    <div className="ticket-row-meta">
                      {contactName && <span>{contactName}</span>}
                    </div>
                  </div>
                  <div className="ticket-row-badges">
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
                  </div>
                  <span className="ticket-row-group">{ticket.group_id ? groups.find((g) => g.id === ticket.group_id)?.name ?? "" : "—"}</span>
                  <div className="ticket-row-agent">
                    {ticket.agent_id ? (
                      <>
                        <span className="avatar avatar-sm" style={{ background: avatarColor(agentNameById.get(ticket.agent_id)) }}>
                          {initials(agentNameById.get(ticket.agent_id))}
                        </span>
                        <span className="ticket-row-agent-name">{agentNameById.get(ticket.agent_id)}</span>
                      </>
                    ) : (
                      <span className="hint">Unassigned</span>
                    )}
                  </div>
                  <span className="ticket-row-time" title={new Date(ticket.created_at).toLocaleString()}>
                    {relativeTime(ticket.created_at)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
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
