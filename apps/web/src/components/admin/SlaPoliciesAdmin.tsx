import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, createSlaPolicy, deleteSlaPolicy, listSlaPolicies } from "../../lib/apiClient";
import type { SlaPolicy } from "../../types/ticket";

export default function SlaPoliciesAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [name, setName] = useState("");
  const [firstResponseMinutes, setFirstResponseMinutes] = useState("60");
  const [resolutionMinutes, setResolutionMinutes] = useState("480");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    listSlaPolicies(tenantId).then(setPolicies);
  };

  useEffect(load, [tenantId]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    const first = Number(firstResponseMinutes);
    const resolution = Number(resolutionMinutes);
    if (!name.trim() || !first || !resolution) return;
    setBusy(true);
    setError(null);
    createSlaPolicy(tenantId, { name, firstResponseTargetMinutes: first, resolutionTargetMinutes: resolution })
      .then(() => {
        setName("");
        setFirstResponseMinutes("60");
        setResolutionMinutes("480");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create SLA policy"))
      .finally(() => setBusy(false));
  };

  const handleDelete = (policy: SlaPolicy) => {
    setError(null);
    deleteSlaPolicy(tenantId, policy.id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete SLA policy"));
  };

  return (
    <div className="admin-entity">
      <h4>SLA policies</h4>
      {error && <p className="error">{error}</p>}
      {policies.length === 0 && <p className="hint">No SLA policies yet.</p>}
      {policies.length > 0 && (
        <ul className="admin-list">
          {policies.map((p) => (
            <li key={p.id}>
              <span>
                <strong>{p.name}</strong>{" "}
                <span className="hint">
                  first response {p.first_response_target_minutes}min · resolution {p.resolution_target_minutes}min
                </span>
              </span>
              <button type="button" className="link-button" onClick={() => handleDelete(p)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <input placeholder="Policy name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input
          type="number"
          min={1}
          placeholder="First response (min)"
          value={firstResponseMinutes}
          onChange={(e) => setFirstResponseMinutes(e.target.value)}
        />
        <input
          type="number"
          min={1}
          placeholder="Resolution (min)"
          value={resolutionMinutes}
          onChange={(e) => setResolutionMinutes(e.target.value)}
        />
        <button type="submit" disabled={busy}>
          Add SLA policy
        </button>
      </form>
    </div>
  );
}
