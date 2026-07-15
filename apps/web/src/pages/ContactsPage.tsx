import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, createContact, listCompanies, listContacts, updateContact } from "../lib/apiClient";
import { avatarColor, initials } from "../lib/avatar";
import { useTenant } from "../lib/tenant";
import type { Company, Contact } from "../types/ticket";

export default function ContactsPage() {
  const { tenantId } = useTenant();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [search, setSearch] = useState("");
  const [needsActionOnly, setNeedsActionOnly] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editCompanyId, setEditCompanyId] = useState("");

  const load = () => {
    if (!tenantId) return;
    Promise.all([listContacts(tenantId, search || undefined, needsActionOnly), listCompanies(tenantId)])
      .then(([contactsRes, companiesRes]) => {
        setContacts(contactsRes);
        setCompanies(companiesRes);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load contacts"));
  };

  useEffect(load, [tenantId, search, needsActionOnly]);

  const companyName = (id: string | null) => companies.find((c) => c.id === id)?.name ?? null;

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId || !name.trim()) return;
    setBusy(true);
    setError(null);
    createContact(tenantId, {
      name,
      email: email || undefined,
      phone: phone || undefined,
      companyId: companyId || undefined,
    })
      .then(() => {
        setName("");
        setEmail("");
        setPhone("");
        setCompanyId("");
        load();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create contact"))
      .finally(() => setBusy(false));
  };

  const startEdit = (contact: Contact) => {
    setEditingId(contact.id);
    setEditName(contact.name);
    setEditEmail(contact.email ?? "");
    setEditPhone(contact.phone ?? "");
    setEditCompanyId(contact.company_id ?? "");
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = (id: string) => {
    if (!tenantId) return;
    setError(null);
    updateContact(tenantId, id, {
      name: editName,
      email: editEmail || undefined,
      phone: editPhone || undefined,
      companyId: editCompanyId || undefined,
    })
      .then(() => {
        setEditingId(null);
        load();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update contact"));
  };

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to view contacts.</p>;
  }

  return (
    <div>
      <h2>Contacts</h2>
      <div className="toolbar">
        <input placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="side-panel-toggle">
          <input
            type="checkbox"
            checked={needsActionOnly}
            onChange={(e) => setNeedsActionOnly(e.target.checked)}
          />
          Needs action only
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {contacts.length === 0 && <p className="hint">No contacts found.</p>}
      {contacts.length > 0 && (
        <ul className="admin-list">
          {contacts.map((contact) =>
            editingId === contact.id ? (
              <li key={contact.id}>
                <span className="admin-form">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <input placeholder="Email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
                  <input placeholder="Phone" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
                  <select value={editCompanyId} onChange={(e) => setEditCompanyId(e.target.value)}>
                    <option value="">No company</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </span>
                <span>
                  <button type="button" className="link-button" onClick={() => saveEdit(contact.id)}>
                    Save
                  </button>
                  <button type="button" className="link-button" onClick={cancelEdit}>
                    Cancel
                  </button>
                </span>
              </li>
            ) : (
              <li key={contact.id}>
                <span>
                  <span className="avatar avatar-sm" style={{ background: avatarColor(contact.name) }}>
                    {initials(contact.name)}
                  </span>
                  <span>
                    <strong>{contact.name}</strong>{" "}
                    <span className="hint">
                      {[contact.email, contact.phone, companyName(contact.company_id)].filter(Boolean).join(" · ")}
                    </span>
                    {!contact.email_valid && <span className="badge sla-state-breached"> invalid email</span>}
                  </span>
                </span>
                <button type="button" className="link-button" onClick={() => startEdit(contact)}>
                  Edit
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
          <option value="">No company</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-primary" disabled={busy}>
          Add contact
        </button>
      </form>
    </div>
  );
}
