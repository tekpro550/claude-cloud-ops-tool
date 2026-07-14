import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, createAgent, listAgents, updateAgent } from "../../lib/apiClient";
import type { Agent } from "../../types/ticket";

export default function AgentsAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");

  const load = () => {
    listAgents(tenantId).then(setAgents);
  };

  useEffect(load, [tenantId]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setBusy(true);
    setError(null);
    createAgent(tenantId, { name, email })
      .then(() => {
        setName("");
        setEmail("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create agent"))
      .finally(() => setBusy(false));
  };

  const handleToggleActive = (agent: Agent) => {
    setError(null);
    updateAgent(tenantId, agent.id, { isActive: !agent.is_active })
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update agent"));
  };

  const startEdit = (agent: Agent) => {
    setEditingId(agent.id);
    setEditName(agent.name);
    setEditEmail(agent.email);
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = (id: string) => {
    if (!editName.trim() || !editEmail.trim()) return;
    setError(null);
    updateAgent(tenantId, id, { name: editName, email: editEmail })
      .then(() => {
        setEditingId(null);
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update agent"));
  };

  return (
    <div className="admin-entity">
      <h4>Agents</h4>
      {error && <p className="error">{error}</p>}
      {agents.length === 0 && <p className="hint">No agents yet.</p>}
      {agents.length > 0 && (
        <ul className="admin-list">
          {agents.map((a) =>
            editingId === a.id ? (
              <li key={a.id}>
                <span className="admin-form">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
                </span>
                <span>
                  <button type="button" className="link-button" onClick={() => saveEdit(a.id)}>
                    Save
                  </button>
                  <button type="button" className="link-button" onClick={cancelEdit}>
                    Cancel
                  </button>
                </span>
              </li>
            ) : (
              <li key={a.id}>
                <span>
                  <strong>{a.name}</strong> <span className="hint">{a.email}</span>{" "}
                  <span className={`badge ${a.is_active ? "status-resolved" : ""}`}>{a.is_active ? "active" : "inactive"}</span>
                </span>
                <span>
                  <button type="button" className="link-button" onClick={() => startEdit(a)}>
                    Edit
                  </button>
                  <button type="button" className="link-button" onClick={() => handleToggleActive(a)}>
                    {a.is_active ? "Deactivate" : "Activate"}
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <input placeholder="Agent name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input type="email" placeholder="Agent email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <button type="submit" disabled={busy}>
          Add agent
        </button>
      </form>
    </div>
  );
}
