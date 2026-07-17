import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import ConfirmDialog from "../components/ConfirmDialog";
import Modal from "../components/Modal";
import { ApiError, createCompany, deleteCompany, listCompanies, updateCompany } from "../lib/apiClient";
import { avatarColor, initials } from "../lib/avatar";
import { useTenant } from "../lib/tenant";
import type { Company } from "../types/ticket";

export default function CompaniesPage() {
  const { tenantId } = useTenant();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [error, setError] = useState<string | null>(null);

  // create/edit modal
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);

  // delete confirmation
  const [confirmTarget, setConfirmTarget] = useState<Company | null>(null);

  const load = () => {
    if (!tenantId) return;
    listCompanies(tenantId)
      .then(setCompanies)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load companies"));
  };

  useEffect(load, [tenantId]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setDomain("");
    setError(null);
    setFormOpen(true);
  };

  const openEdit = (company: Company) => {
    setEditing(company);
    setName(company.name);
    setDomain(company.domain ?? "");
    setError(null);
    setFormOpen(true);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!tenantId || !name.trim()) return;
    setBusy(true);
    setError(null);
    const request = editing
      ? updateCompany(tenantId, editing.id, { name, domain: domain || undefined })
      : createCompany(tenantId, { name, domain: domain || undefined });
    request
      .then(() => {
        setFormOpen(false);
        load();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to save company"))
      .finally(() => setBusy(false));
  };

  const handleDelete = () => {
    if (!tenantId || !confirmTarget) return;
    const target = confirmTarget;
    setConfirmTarget(null);
    setError(null);
    deleteCompany(tenantId, target.id)
      .then(load)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete company"));
  };

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to view companies.</p>;
  }

  return (
    <div>
      <div className="page-header">
        <h2>Companies</h2>
        <button type="button" className="btn-primary" onClick={openCreate}>
          Add company
        </button>
      </div>
      {error && !formOpen && <p className="error">{error}</p>}
      {companies.length === 0 && <p className="hint">No companies yet.</p>}
      {companies.length > 0 && (
        <ul className="admin-list">
          {companies.map((company) => (
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
                <button type="button" className="link-button" onClick={() => openEdit(company)}>
                  Edit
                </button>
                <button type="button" className="link-button" onClick={() => setConfirmTarget(company)}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {formOpen && (
        <Modal title={editing ? "Edit company" : "Add company"} onClose={() => setFormOpen(false)}>
          {error && <p className="error">{error}</p>}
          <form className="modal-form" onSubmit={handleSubmit}>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </label>
            <label>
              Domain
              <input placeholder="example.com (optional)" value={domain} onChange={(e) => setDomain(e.target.value)} />
            </label>
            <div className="modal-form-actions">
              <button type="button" onClick={() => setFormOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {editing ? "Save changes" : "Add company"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmTarget && (
        <ConfirmDialog
          title="Delete company"
          message={`Delete “${confirmTarget.name}”? This can't be undone.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </div>
  );
}
