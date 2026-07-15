import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, createCompany, deleteCompany, listCompanies, updateCompany } from "../lib/apiClient";
import { avatarColor, initials } from "../lib/avatar";
import { useTenant } from "../lib/tenant";
import type { Company } from "../types/ticket";

export default function CompaniesPage() {
  const { tenantId } = useTenant();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDomain, setEditDomain] = useState("");

  const load = () => {
    if (!tenantId) return;
    listCompanies(tenantId)
      .then(setCompanies)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load companies"));
  };

  useEffect(load, [tenantId]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId || !name.trim()) return;
    setBusy(true);
    setError(null);
    createCompany(tenantId, { name, domain: domain || undefined })
      .then(() => {
        setName("");
        setDomain("");
        load();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create company"))
      .finally(() => setBusy(false));
  };

  const startEdit = (company: Company) => {
    setEditingId(company.id);
    setEditName(company.name);
    setEditDomain(company.domain ?? "");
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = (id: string) => {
    if (!tenantId) return;
    setError(null);
    updateCompany(tenantId, id, { name: editName, domain: editDomain || undefined })
      .then(() => {
        setEditingId(null);
        load();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update company"));
  };

  const handleDelete = (company: Company) => {
    if (!tenantId) return;
    setError(null);
    deleteCompany(tenantId, company.id)
      .then(load)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete company"));
  };

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to view companies.</p>;
  }

  return (
    <div>
      <h2>Companies</h2>
      {error && <p className="error">{error}</p>}
      {companies.length === 0 && <p className="hint">No companies yet.</p>}
      {companies.length > 0 && (
        <ul className="admin-list">
          {companies.map((company) =>
            editingId === company.id ? (
              <li key={company.id}>
                <span className="admin-form">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <input placeholder="Domain" value={editDomain} onChange={(e) => setEditDomain(e.target.value)} />
                </span>
                <span>
                  <button type="button" className="link-button" onClick={() => saveEdit(company.id)}>
                    Save
                  </button>
                  <button type="button" className="link-button" onClick={cancelEdit}>
                    Cancel
                  </button>
                </span>
              </li>
            ) : (
              <li key={company.id}>
                <span>
                  <span className="avatar avatar-sm" style={{ background: avatarColor(company.name) }}>
                    {initials(company.name)}
                  </span>
                  <span>
                    <strong>{company.name}</strong>
                    {company.domain && <span className="hint"> — {company.domain}</span>}
                    <span className="hint">
                      {" "}
                      · {company.contact_count} contact{company.contact_count === 1 ? "" : "s"}
                    </span>
                  </span>
                </span>
                <span>
                  <button type="button" className="link-button" onClick={() => startEdit(company)}>
                    Edit
                  </button>
                  <button type="button" className="link-button" onClick={() => handleDelete(company)}>
                    Delete
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <input placeholder="Company name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="Domain (optional)" value={domain} onChange={(e) => setDomain(e.target.value)} />
        <button type="submit" className="btn-primary" disabled={busy}>
          Add company
        </button>
      </form>
    </div>
  );
}
