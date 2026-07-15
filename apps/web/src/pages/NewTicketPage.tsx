import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  addTicketMessage,
  ApiError,
  createTicket,
  listAgents,
  listContacts,
  listGroups,
  listTicketTypes,
} from "../lib/apiClient";
import { useTenant } from "../lib/tenant";
import type { Agent, Contact, Group, TicketPriority, TicketType } from "../types/ticket";

const PRIORITIES: TicketPriority[] = ["low", "medium", "high", "urgent"];

/**
 * Separate from Compose email on purpose (per the UI review): this logs a
 * ticket -- a phone call, something noticed internally -- with its
 * properties set up front, without implying an email gets sent to anyone.
 * Compose email stays the flow for when the point actually is emailing a
 * contact.
 */
export default function NewTicketPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);

  const [contactId, setContactId] = useState("");
  const [newContactName, setNewContactName] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [ticketTypeId, setTicketTypeId] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [groupId, setGroupId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [description, setDescription] = useState("");

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    Promise.all([listContacts(tenantId), listGroups(tenantId), listAgents(tenantId), listTicketTypes(tenantId)]).then(
      ([contactsRes, groupsRes, agentsRes, typesRes]) => {
        setContacts(contactsRes);
        setGroups(groupsRes);
        setAgents(agentsRes);
        setTicketTypes(typesRes);
      },
    );
  }, [tenantId]);

  const usingNewContact = contactId === "";

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId) return;
    if (usingNewContact && (!newContactName.trim() || !newContactEmail.trim())) return;
    setCreating(true);
    setError(null);

    createTicket(tenantId, {
      subject,
      contactId: contactId || undefined,
      contact: usingNewContact ? { name: newContactName, email: newContactEmail } : undefined,
      source: "web_form",
      ticketTypeId: ticketTypeId || undefined,
      groupId: groupId || undefined,
      agentId: agentId || undefined,
      priority,
    })
      .then((ticket) =>
        description.trim()
          ? addTicketMessage(tenantId, ticket.id, { type: "note", authorType: "agent", body: description }).then(
              () => ticket,
            )
          : ticket,
      )
      .then((ticket) => navigate(`/tickets/${ticket.id}`))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create ticket"))
      .finally(() => setCreating(false));
  };

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to create a ticket.</p>;
  }

  return (
    <div>
      <h2>New ticket</h2>
      <p className="hint">Log a ticket for anything — a call, a walk-in issue, something noticed internally.</p>
      {error && <p className="error">{error}</p>}
      <form className="new-ticket-full-form" onSubmit={handleSubmit}>
        <label>
          Contact
          <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
            <option value="">New contact…</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.email ? `<${c.email}>` : ""}
              </option>
            ))}
          </select>
        </label>
        {usingNewContact && (
          <div className="admin-form-row">
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
          </div>
        )}

        <label>
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} required />
        </label>

        <div className="admin-form-row">
          <label>
            Type
            <select value={ticketTypeId} onChange={(e) => setTicketTypeId(e.target.value)}>
              <option value="">—</option>
              {ticketTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label>
            Group
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">—</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Agent
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Unassigned</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          Description
          <textarea
            placeholder="What's going on?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
          />
        </label>

        <button type="submit" disabled={creating}>
          {creating ? "Creating…" : "Create ticket"}
        </button>
      </form>
    </div>
  );
}
