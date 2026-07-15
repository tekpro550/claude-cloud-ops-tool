import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, composeOutbound, listContacts } from "../lib/apiClient";
import { useTenant } from "../lib/tenant";
import type { Contact } from "../types/ticket";

export default function ComposeOutboundPage() {
  const { tenantId } = useTenant();
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState("");
  const [newContactName, setNewContactName] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    listContacts(tenantId).then(setContacts);
  }, [tenantId]);

  const usingNewContact = contactId === "";

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId) return;
    if (usingNewContact && (!newContactName.trim() || !newContactEmail.trim())) return;
    setSending(true);
    setError(null);
    composeOutbound(tenantId, {
      contactId: contactId || undefined,
      contact: usingNewContact ? { name: newContactName, email: newContactEmail } : undefined,
      subject,
      body,
    })
      .then((ticket) => navigate(`/tickets/${ticket.id}`))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to send"))
      .finally(() => setSending(false));
  };

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to compose an email.</p>;
  }

  return (
    <div>
      <h2>Compose email</h2>
      <p className="hint">Proactively email a contact — this opens a new ticket with your message as the first reply.</p>
      {error && <p className="error">{error}</p>}
      <form className="compose-outbound-form" onSubmit={handleSubmit}>
        <label>
          To
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
        <input placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
        <textarea placeholder="Message" value={body} onChange={(e) => setBody(e.target.value)} rows={8} required />
        <button type="submit" className="btn-primary" disabled={sending}>
          {sending ? "Sending…" : "Send and create ticket"}
        </button>
      </form>
    </div>
  );
}
