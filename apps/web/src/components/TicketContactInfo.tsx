import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, getContact, listCompanies, updateContact } from "../lib/apiClient";
import type { Company, Contact } from "../types/ticket";

export default function TicketContactInfo({ tenantId, contactId }: { tenantId: string; contactId: string }) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    Promise.all([getContact(tenantId, contactId), listCompanies(tenantId)]).then(([contactRes, companiesRes]) => {
      setContact(contactRes);
      setCompanies(companiesRes);
    });
  };

  useEffect(load, [tenantId, contactId]);

  const companyName = (id: string | null) => companies.find((c) => c.id === id)?.name ?? null;

  const startEdit = () => {
    if (!contact) return;
    setName(contact.name);
    setEmail(contact.email ?? "");
    setPhone(contact.phone ?? "");
    setCompanyId(contact.company_id ?? "");
    setEditing(true);
  };

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    updateContact(tenantId, contactId, {
      name,
      email: email || undefined,
      phone: phone || undefined,
      companyId: companyId || undefined,
    })
      .then((updated) => {
        setContact(updated);
        setEditing(false);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update contact"))
      .finally(() => setSaving(false));
  };

  if (!contact) {
    return <p className="hint">Loading…</p>;
  }

  if (editing) {
    return (
      <form className="admin-form" onSubmit={handleSave}>
        {error && <p className="error">{error}</p>}
        <input value={name} onChange={(e) => setName(e.target.value)} required />
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
        <span>
          <button type="submit" disabled={saving}>
            Save
          </button>
          <button type="button" className="link-button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </span>
      </form>
    );
  }

  return (
    <div className="contact-info">
      <p>
        <strong>{contact.name}</strong>
      </p>
      {contact.email && <p className="hint">{contact.email}</p>}
      {contact.phone && <p className="hint">{contact.phone}</p>}
      {companyName(contact.company_id) && <p className="hint">{companyName(contact.company_id)}</p>}
      <button type="button" className="link-button" onClick={startEdit}>
        Edit
      </button>
    </div>
  );
}
