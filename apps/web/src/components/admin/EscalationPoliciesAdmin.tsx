import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import { createEscalationPolicy, deleteEscalationPolicy, listEscalationPolicies } from "../../lib/monitoringApiClient";
import type { EscalationPolicy } from "../../types/monitoring";

const STEPS_PLACEHOLDER = JSON.stringify(
  [
    { delayMinutes: 0, notify: [{ channel: "email", recipient: "oncall@example.com" }] },
    { delayMinutes: 15, notify: [{ channel: "email", recipient: "manager@example.com" }] },
  ],
  null,
  2,
);

export default function EscalationPoliciesAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [policies, setPolicies] = useState<EscalationPolicy[]>([]);
  const [name, setName] = useState("");
  const [stepsJson, setStepsJson] = useState(STEPS_PLACEHOLDER);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    listEscalationPolicies(tenantId).then(setPolicies);
  };

  useEffect(load, [tenantId]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    let steps: EscalationPolicy["steps"];
    try {
      steps = JSON.parse(stepsJson);
    } catch {
      setError("Steps must be valid JSON");
      return;
    }
    setError(null);
    createEscalationPolicy(tenantId, { name, steps })
      .then(() => {
        setName("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create escalation policy"));
  };

  const handleDelete = (id: string) => {
    deleteEscalationPolicy(tenantId, id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete escalation policy"));
  };

  return (
    <div className="admin-entity">
      <h4>Escalation policies</h4>
      {error && <p className="error">{error}</p>}
      {policies.length === 0 && <p className="hint">No escalation policies yet.</p>}
      {policies.length > 0 && (
        <ul className="admin-list">
          {policies.map((p) => (
            <li key={p.id}>
              <span>
                <strong>{p.name}</strong> <span className="hint">— {p.steps.length} step(s)</span>
              </span>
              <span>
                <button type="button" className="link-button" onClick={() => handleDelete(p.id)}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <input placeholder="Policy name" value={name} onChange={(e) => setName(e.target.value)} required />
        <textarea
          rows={6}
          style={{ width: "100%", fontFamily: "monospace" }}
          value={stepsJson}
          onChange={(e) => setStepsJson(e.target.value)}
        />
        <button type="submit">Create policy</button>
      </form>
    </div>
  );
}
