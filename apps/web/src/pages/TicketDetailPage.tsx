import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  addTicketMessage,
  ApiError,
  downloadTicketAttachment,
  getContact,
  getPresence,
  getTicket,
  getTicketSatisfaction,
  heartbeatPresence,
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
import { useAuth } from "../lib/auth";
import { avatarColor, initials } from "../lib/avatar";
import { platformLabel, PLATFORMS } from "../lib/platform";
import { dueLabel, relativeTime } from "../lib/relativeTime";
import { formatTicketNumber } from "../lib/ticketNumber";
import { useTenant } from "../lib/tenant";
import RichTextEditor from "../components/RichTextEditor";
import SidePanel from "../components/SidePanel";
import TicketContactInfo from "../components/TicketContactInfo";
import TicketScenarios from "../components/TicketScenarios";
import TicketTags from "../components/TicketTags";
import TicketTimeline from "../components/TicketTimeline";
import TicketTodos from "../components/TicketTodos";
import TicketTimeLogs from "../components/TicketTimeLogs";
import type {
  Agent,
  CannedResponse,
  CannedResponseFolder,
  Contact,
  Group,
  Ticket,
  TicketAttachment,
  TicketMessage,
  TicketMessageType,
  TicketPresenceEntry,
  TicketPriority,
  TicketSatisfactionEntry,
  TicketStatus,
  TicketType,
} from "../types/ticket";

const PRESENCE_POLL_MS = 5000;

const STATUSES: TicketStatus[] = ["new", "open", "pending", "resolved", "closed"];
const PRIORITIES: TicketPriority[] = ["low", "medium", "high", "urgent"];
const MESSAGE_TYPES: TicketMessageType[] = ["reply", "note", "forward"];

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { tenantId } = useTenant();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
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

  const { user } = useAuth();
  const [presence, setPresence] = useState<TicketPresenceEntry[]>([]);
  const [satisfaction, setSatisfaction] = useState<TicketSatisfactionEntry | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () => {
    if (!tenantId || !id) return;
    setLoading(true);
    setError(null);
    Promise.all([getTicket(tenantId, id), listTicketMessages(tenantId, id), listTicketAttachments(tenantId, id)])
      .then(([ticketRes, messagesRes, attachmentsRes]) => {
        setTicket(ticketRes);
        setMessages(messagesRes);
        setAttachments(attachmentsRes);
        getContact(tenantId, ticketRes.contact_id)
          .then(setContact)
          .catch(() => {
            // The header's "Reported by" line is decorative; a lookup
            // failure shouldn't block the rest of the ticket from loading.
          });
        getTicketSatisfaction(tenantId, id)
          .then(setSatisfaction)
          .catch(() => {
            // The CSAT panel is supplementary; a lookup failure shouldn't
            // block the rest of the ticket from loading.
          });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load ticket"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [tenantId, id]);

  // Poll for other agents' presence, and heartbeat our own "viewing" state,
  // since there's no realtime/websocket transport in this app yet.
  useEffect(() => {
    if (!tenantId || !id) return;
    const poll = () => getPresence(tenantId, id).then(setPresence).catch(() => {});
    poll();
    const interval = setInterval(poll, PRESENCE_POLL_MS);
    return () => clearInterval(interval);
  }, [tenantId, id]);

  useEffect(() => {
    if (!tenantId || !id || !user) return;
    const beat = () => heartbeatPresence(tenantId, id, false).catch(() => {});
    beat();
    const interval = setInterval(beat, PRESENCE_POLL_MS);
    return () => clearInterval(interval);
  }, [tenantId, id, user]);

  const notifyTyping = () => {
    if (!tenantId || !id || !user) return;
    heartbeatPresence(tenantId, id, true).catch(() => {});
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      heartbeatPresence(tenantId, id, false).catch(() => {});
    }, 3000);
  };

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

  const handleTagsChange = (next: string[]) => {
    if (!tenantId || !id) return;
    setSaving(true);
    setError(null);
    updateTicket(tenantId, id, { tags: next })
      .then((updated) => {
        setTicket(updated);
        bumpTimeline();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update tags"))
      .finally(() => setSaving(false));
  };

  const handleAddMessage = (event: FormEvent) => {
    event.preventDefault();
    // messageBody is now HTML; treat an editor holding only tags/whitespace
    // (e.g. "<br>") as empty.
    const hasContent = messageBody.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length > 0;
    if (!tenantId || !id || !hasContent) return;
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
    if (!response) return;
    // Freshdesk-style placeholder substitution on insert, using the live
    // ticket/contact/agent context. Unknown placeholders are left as-is.
    const agentName = ticket?.agent_id ? agents.find((a) => a.id === ticket.agent_id)?.name ?? "" : user?.name ?? "";
    const values: Record<string, string> = {
      "ticket.number": ticket ? formatTicketNumber(ticket) : "",
      "ticket.subject": ticket?.subject ?? "",
      "contact.name": contact?.name ?? "",
      "contact.email": contact?.email ?? "",
      "agent.name": agentName,
    };
    const filled = response.body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) =>
      key in values ? values[key] : match,
    );
    setMessageBody(filled);
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
          <label>
            Tags
            <TicketTags
              tags={ticket.tags ?? []}
              disabled={saving}
              onChange={handleTagsChange}
            />
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
    {
      id: "satisfaction",
      title: "Satisfaction",
      content: satisfaction ? (
        <div className="satisfaction-panel">
          <span className={`badge csat-${satisfaction.rating}`}>
            {satisfaction.rating === "happy" ? "😊 Happy" : satisfaction.rating === "neutral" ? "😐 Neutral" : "😞 Unhappy"}
          </span>
          {satisfaction.comment && <p className="hint">"{satisfaction.comment}"</p>}
          <span className="hint">Rated {relativeTime(satisfaction.rated_at)}</span>
        </div>
      ) : (
        <p className="hint">Not yet rated by the customer.</p>
      ),
    },
  ];

  return (
    <div>
      <p>
        <Link to="/">&larr; Back to tickets</Link>
      </p>

      <div className="ticket-detail-header">
        <div className="ticket-detail-title">
          <span className="ticket-row-number">{formatTicketNumber(ticket)}</span>
          <h2>{ticket.subject}</h2>
          <span className={`badge status-${ticket.status}`}>{ticket.status}</span>
          <span className={`badge priority-${ticket.priority}`}>{ticket.priority}</span>
        </div>
        <div className="ticket-detail-meta">
          {contact && (
            <span>
              Reported by <strong>{contact.name}</strong>
            </span>
          )}
          <span>· {relativeTime(ticket.created_at)}</span>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="ticket-detail-layout">
        <div className="ticket-main">
          <h3>Conversation</h3>
          {messages.length === 0 && <p className="hint">No messages yet.</p>}
          <ul className="message-thread">
            {messages.map((message) => {
              const messageAttachments = attachments.filter((a) => a.ticket_message_id === message.id);
              const displayName =
                message.author_type === "contact" ? contact?.name ?? "Contact" : message.author_type === "agent" ? "Agent" : "System";
              const isAgentAligned = message.type !== "note" && message.author_type === "agent";
              return (
                <li
                  key={message.id}
                  className={`message-${message.type} message-row${isAgentAligned ? " message-row-agent" : ""}`}
                >
                  <span className="avatar avatar-sm" style={{ background: avatarColor(displayName) }}>
                    {initials(displayName)}
                  </span>
                  <div className="message">
                    <div className="message-meta">
                      {message.type === "note" && <span className="message-type-label">Private note</span>}
                      {message.type === "forward" && <span className="message-type-label">Forwarded</span>}
                      <strong>{displayName}</strong>
                      <span>{new Date(message.created_at).toLocaleString()}</span>
                    </div>
                    {/* Bodies are sanitized server-side on write (see
                        sanitizeTicketBody), so the stored HTML is safe to render. */}
                    <div className="message-body" dangerouslySetInnerHTML={{ __html: message.body }} />
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
                  </div>
                </li>
              );
            })}
          </ul>

          <form
            className={`message-composer${messageType === "note" ? " message-composer-note" : ""}`}
            onSubmit={handleAddMessage}
          >
            <div className="message-composer-toolbar">
              <div className="composer-type-tabs">
                {MESSAGE_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`composer-type-tab${messageType === t ? ` composer-type-tab-active composer-type-tab-${t}` : ""}`}
                    onClick={() => setMessageType(t)}
                  >
                    {t === "reply" ? "Reply" : t === "note" ? "Note" : "Forward"}
                  </button>
                ))}
              </div>
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
            {presence.length > 0 && (
              <p className="hint presence-banner">
                {presence.map((p) => (p.is_typing ? `${p.agent_name} is replying…` : `${p.agent_name} is viewing this ticket`)).join(" · ")}
              </p>
            )}
            <RichTextEditor
              value={messageBody}
              onChange={setMessageBody}
              onInput={notifyTyping}
              placeholder={messageType === "note" ? "Write a private note (not sent to the customer)…" : "Write a reply…"}
            />
            <input
              type="file"
              onChange={(e) => setMessageFile(e.target.files?.[0] ?? null)}
              aria-label="Attach a file"
            />
            <button type="submit" className="btn-primary" disabled={posting} style={{ alignSelf: "flex-start" }}>
              {posting ? "Posting…" : messageType === "note" ? "Add note" : "Send"}
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
