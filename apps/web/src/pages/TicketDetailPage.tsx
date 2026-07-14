import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  addTicketMessage,
  ApiError,
  downloadTicketAttachment,
  getTicket,
  listAgents,
  listCannedResponseFolders,
  listCannedResponses,
  listGroups,
  listTicketAttachments,
  listTicketMessages,
  listTicketTypes,
  updateTicket,
  uploadTicketAttachment,
  type UpdateTicketInput,
} from "../lib/apiClient";
import { platformLabel, PLATFORMS } from "../lib/platform";
import { dueLabel, relativeTime } from "../lib/relativeTime";
import { formatTicketNumber } from "../lib/ticketNumber";
import { useTenant } from "../lib/tenant";
import SidePanel from "../components/SidePanel";
import TicketContactInfo from "../components/TicketContactInfo";
import TicketScenarios from "../components/TicketScenarios";
import TicketTimeline from "../components/TicketTimeline";
import TicketTodos from "../components/TicketTodos";
import TicketTimeLogs from "../components/TicketTimeLogs";
import type {
  Agent,
  CannedResponse,
  CannedResponseFolder,
  Group,
  Ticket,
  TicketAttachment,
  TicketMessage,
  TicketMessageType,
  TicketPriority,
  TicketStatus,
  TicketType,
} from "../types/ticket";

const STATUSES: TicketStatus[] = ["new", "open", "pending", "resolved", "closed"];
const PRIORITIES: TicketPriority[] = ["low", "medium", "high", "urgent"];
const MESSAGE_TYPES: TicketMessageType[] = ["reply", "note", "forward"];

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { tenantId } = useTenant();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [cannedResponses, setCannedResponses] = useState<CannedResponse[]>([]);
  const [cannedResponseFolders, setCannedResponseFolders] = useState<CannedResponseFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [messageType, setMessageType] = useState<TicketMessageType>("note");
  const [messageBody, setMessageBody] = useState("");
  const [messageFile, setMessageFile] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);
  const [timelineRefreshSignal, setTimelineRefreshSignal] = useState(0);
  const bumpTimeline = () => setTimelineRefreshSignal((s) => s + 1);

  const load = () => {
    if (!tenantId || !id) return;
    setLoading(true);
    setError(null);
    Promise.all([getTicket(tenantId, id), listTicketMessages(tenantId, id), listTicketAttachments(tenantId, id)])
      .then(([ticketRes, messagesRes, attachmentsRes]) => {
        setTicket(ticketRes);
        setMessages(messagesRes);
        setAttachments(attachmentsRes);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load ticket"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tenantId, id]);

  useEffect(() => {
    if (!tenantId) return;
    Promise.all([
      listGroups(tenantId),
      listAgents(tenantId),
      listTicketTypes(tenantId),
      listCannedResponses(tenantId),
      listCannedResponseFolders(tenantId),
    ])
      .then(([groupsRes, agentsRes, typesRes, cannedRes, foldersRes]) => {
        setGroups(groupsRes);
        setAgents(agentsRes);
        setTicketTypes(typesRes);
        setCannedResponses(cannedRes);
        setCannedResponseFolders(foldersRes);
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
      .then((updated) => {
        setTicket(updated);
        bumpTimeline();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update ticket"))
      .finally(() => setSaving(false));
  };

  const handleAddMessage = (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId || !id || !messageBody.trim()) return;
    setPosting(true);
    setError(null);
    // authorType is a fallback for the (now rare) unauthenticated case --
    // when the request carries a real agent JWT, the backend overrides this
    // to the logged-in agent's own identity regardless of what's sent here
    // (see TicketsController.addMessage), so a logged-in agent's replies are
    // correctly attributed rather than showing up as "system".
    addTicketMessage(tenantId, id, { type: messageType, authorType: "system", body: messageBody })
      .then((message) => (messageFile ? uploadTicketAttachment(tenantId, id, message.id, messageFile) : null))
      .then(() => {
        setMessageBody("");
        setMessageFile(null);
        return Promise.all([listTicketMessages(tenantId, id), listTicketAttachments(tenantId, id)]);
      })
      .then(([messagesRes, attachmentsRes]) => {
        setMessages(messagesRes);
        setAttachments(attachmentsRes);
        bumpTimeline();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to add message"))
      .finally(() => setPosting(false));
  };

  const handleDownloadAttachment = (attachment: TicketAttachment) => {
    if (!tenantId || !id) return;
    downloadTicketAttachment(tenantId, id, attachment).catch((err) =>
      setError(err instanceof ApiError ? err.message : "Failed to download attachment"),
    );
  };

  const handlePickCannedResponse = (id: string) => {
    const response = cannedResponses.find((r) => r.id === id);
    if (response) setMessageBody(response.body);
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

  const sections = [
    {
      id: "contact",
      title: "Contact",
      content: <TicketContactInfo tenantId={tenantId} contactId={ticket.contact_id} />,
    },
    {
      id: "properties",
      title: "Properties",
      content: (
        <div className="properties-panel">
          <label>
            Status
            <select value={ticket.status} disabled={saving} onChange={(e) => handlePropertyChange("status", e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select value={ticket.priority} disabled={saving} onChange={(e) => handlePropertyChange("priority", e.target.value)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            Group
            <select value={ticket.group_id ?? ""} disabled={saving} onChange={(e) => handlePropertyChange("groupId", e.target.value)}>
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
            <select value={ticket.agent_id ?? ""} disabled={saving} onChange={(e) => handlePropertyChange("agentId", e.target.value)}>
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
          <label>
            Platform
            <select
              value={ticket.platform ?? ""}
              disabled={saving}
              onChange={(e) => handlePropertyChange("platform", e.target.value)}
            >
              <option value="" disabled>
                Not set
              </option>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {platformLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <span className="hint">Source: {ticket.source}</span>
        </div>
      ),
    },
    {
      id: "scenarios",
      title: "Scenarios",
      content: (
        <TicketScenarios
          tenantId={tenantId}
          ticketId={ticket.id}
          onApplied={(updated) => {
            setTicket(updated);
            bumpTimeline();
          }}
        />
      ),
    },
    {
      id: "sla",
      title: "SLA",
      content: (
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
      ),
    },
    {
      id: "timeline",
      title: "Timeline",
      content: (
        <TicketTimeline
          tenantId={tenantId}
          ticketId={ticket.id}
          refreshSignal={timelineRefreshSignal}
          groups={groups}
          agents={agents}
          ticketTypes={ticketTypes}
        />
      ),
    },
    {
      id: "todos",
      title: "To-dos",
      content: <TicketTodos tenantId={tenantId} ticketId={ticket.id} />,
    },
    {
      id: "time-logs",
      title: "Time logs",
      content: <TicketTimeLogs tenantId={tenantId} ticketId={ticket.id} onChange={bumpTimeline} />,
    },
  ];

  return (
    <div>
      <p>
        <Link to="/">&larr; Back to tickets</Link>
      </p>

      <h2>
        #{formatTicketNumber(ticket)} {ticket.subject}
      </h2>

      {error && <p className="error">{error}</p>}

      <div className="ticket-detail-layout">
        <div className="ticket-main">
          <h3>Messages</h3>
          {messages.length === 0 && <p className="hint">No messages yet.</p>}
          <ul className="message-thread">
            {messages.map((message) => {
              const messageAttachments = attachments.filter((a) => a.ticket_message_id === message.id);
              return (
                <li key={message.id} className={`message message-${message.type}`}>
                  <div className="message-meta">
                    <strong>{message.type}</strong> by {message.author_type} · {new Date(message.created_at).toLocaleString()}
                  </div>
                  <div className="message-body">{message.body}</div>
                  {messageAttachments.length > 0 && (
                    <ul className="message-attachments">
                      {messageAttachments.map((a) => (
                        <li key={a.id}>
                          <button type="button" className="link-button" onClick={() => handleDownloadAttachment(a)}>
                            {a.file_name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          <form className="message-composer" onSubmit={handleAddMessage}>
            <div className="message-composer-toolbar">
              <select value={messageType} onChange={(e) => setMessageType(e.target.value as TicketMessageType)}>
                {MESSAGE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              {cannedResponses.length > 0 && (
                <select defaultValue="" onChange={(e) => handlePickCannedResponse(e.target.value)}>
                  <option value="" disabled>
                    Insert canned response…
                  </option>
                  {cannedResponseFolders.length === 0
                    ? cannedResponses.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.title}
                        </option>
                      ))
                    : [...cannedResponseFolders, null].map((folder) => {
                        const inFolder = cannedResponses.filter((r) => r.folder_id === (folder?.id ?? null));
                        if (inFolder.length === 0) return null;
                        return (
                          <optgroup key={folder?.id ?? "unfiled"} label={folder?.name ?? "Unfiled"}>
                            {inFolder.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.title}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                </select>
              )}
            </div>
            <textarea
              placeholder="Write a message…"
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              rows={3}
              required
            />
            <input
              type="file"
              onChange={(e) => setMessageFile(e.target.files?.[0] ?? null)}
              aria-label="Attach a file"
            />
            <button type="submit" disabled={posting}>
              {posting ? "Posting…" : "Add message"}
            </button>
          </form>
        </div>

        <SidePanel sections={sections} />
      </div>
    </div>
  );
}

function SlaDueBadge({ label, iso }: { label: string; iso: string }) {
  const { text, overdue } = dueLabel(iso);
  return (
    <span className={`hint sla-due${overdue ? " overdue" : ""}`}>
      {label} {text}
    </span>
  );
}
