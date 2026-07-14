import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import { createAgentToken, deleteAgentToken, listAgentTokens, listResources } from "../../lib/monitoringApiClient";
import type { AgentToken, Resource } from "../../types/monitoring";

/** Shows the signed device token exactly once, at creation -- see AgentTokensService, it isn't stored raw server-side. */
export default function AgentTokensAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [tokens, setTokens] = useState<AgentToken[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [label, setLabel] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    listAgentTokens(tenantId).then(setTokens);
    listResources(tenantId).then(setResources);
  };

  useEffect(load, [tenantId]);

  const resourceName = (id: string) => resources.find((r) => r.id === id)?.name ?? id;

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!resourceId || !label.trim()) return;
    setError(null);
    createAgentToken(tenantId, { resourceId, label })
      .then((created) => {
        setNewToken(created.token ?? null);
        setResourceId("");
        setLabel("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create agent token"));
  };

  const handleRevoke = (id: string) => {
    deleteAgentToken(tenantId, id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to revoke agent token"));
  };

  return (
    <div className="admin-entity">
      <h4>Agent tokens</h4>
      {error && <p className="error">{error}</p>}
      {newToken && (
        <p className="hint">
          New device token (copy it now — it won't be shown again):
          <br />
          <code>{newToken}</code>
          <button type="button" className="link-button" onClick={() => setNewToken(null)}>
            Dismiss
          </button>
        </p>
      )}
      {tokens.length === 0 && <p className="hint">No agent tokens yet.</p>}
      {tokens.length > 0 && (
        <ul className="admin-list">
          {tokens.map((t) => (
            <li key={t.id}>
              <span>
                <strong>{t.label}</strong> <span className="hint">on {resourceName(t.resource_id)}</span>{" "}
                {!t.is_enabled && <span className="hint">(revoked)</span>}
                {t.last_seen_at && <span className="hint"> · last seen {new Date(t.last_seen_at).toLocaleString()}</span>}
              </span>
              <span>
                <button type="button" className="link-button" onClick={() => handleRevoke(t.id)}>
                  Revoke
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <select value={resourceId} onChange={(e) => setResourceId(e.target.value)} required>
          <option value="">Select a resource…</option>
          {resources.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <input placeholder="Label (e.g. prod-db-01)" value={label} onChange={(e) => setLabel(e.target.value)} required />
        <button type="submit">Issue token</button>
      </form>
    </div>
  );
}
