import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Modal from "../components/Modal";
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
  const [error, setError] = useState<string | null>(null);

  // create/edit modal
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [busy, setBusy] = useState(false);

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

  const openCreate = () => {
    setEditing(null);
    setName("");
    setEmail("");
    setPhone("");
    setCompanyId("");
    setError(null);
    setFormOpen(true);
  };

  const openEdit = (contact: Contact) => {
    setEditing(contact);
    setName(contact.name);
    setEmail(contact.email ?? "");
    setPhone(contact.phone ?? "");
    setCompanyId(contact.company_id ?? "");
    setError(null);
    setFormOpen(true);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId || !name.trim()) return;
    setBusy(true);
    setError(null);
    const payload = {
      name,
      email: email || undefined,
      phone: phone || undefined,
      companyId: companyId || undefined,
    };
    const request = editing
      ? updateContact(tenantId, editing.id, payload)
      : createContact(tenantId, payload);
    request
      .then(() => {
        setFormOpen(false);
        load();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to save contact"))
      .finally(() => setBusy(false));
  };

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to view contacts.</p>;
  }

  return (
    <div>
      <div className="page-header">
        <h2>Contacts</h2>
        <button type="button" className="btn-primary" onClick={openCreate}>
          Add contact
        </button>
      </div>
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
      {error && !formOpen && <p className="error">{error}</p>}
      {contacts.length === 0 && <p className="hint">No contacts found.</p>}
      {contacts.length > 0 && (
        <ul className="admin-list">
          {contacts.map((contact) => (
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
              <button type="button" className="link-button" onClick={() => openEdit(contact)}>
                Edit
              </button>
            </li>
          ))}
        </ul>
      )}

      {formOpen && (
        <Modal title={editing ? "Edit contact" : "Add contact"} onClose={() => setFormOpen(false)}>
          {error && <p className="error">{error}</p>}
          <form className="modal-form" onSubmit={handleSubmit}>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </label>
            <label>
              Email
              <input placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              Phone
              <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label>
              Company
              <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">No company</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="modal-form-actions">
              <button type="button" onClick={() => setFormOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {editing ? "Save changes" : "Add contact"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
