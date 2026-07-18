import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import { createRumAppKey, deleteRumAppKey, listRumAppKeys } from "../../lib/monitoringApiClient";
import type { RumAppKey } from "../../types/monitoring";
import { useConfirm } from "../useConfirm";

/** Shows the signed app key exactly once, at creation -- see RumService.createAppKey. */
export default function RumAppKeysAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [keys, setKeys] = useState<RumAppKey[]>([]);
  const [appName, setAppName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const load = () => {
    listRumAppKeys(tenantId).then(setKeys);
  };

  useEffect(load, [tenantId]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!appName.trim()) return;
    setError(null);
    createRumAppKey(tenantId, appName.trim())
      .then((created) => {
        setNewToken(created.token ?? null);
        setAppName("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create RUM app key"));
  };

  const handleDelete = (key: RumAppKey) => {
    deleteRumAppKey(tenantId, key.id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete RUM app key"));
  };

  return (
    <div className="admin-entity">
      <h4>RUM app keys</h4>
      <p className="hint">
        This key is safe to embed in public, client-side JavaScript — it only lets a beacon write events into your
        tenant, never read anything back. See <code>docs/apm-rum-integration.md</code> for the browser snippet.
      </p>
      {error && <p className="error">{error}</p>}
      {newToken && (
        <p className="hint">
          New app key (copy it now — it won't be shown again):
          <br />
          <code>{newToken}</code>
          <button type="button" className="link-button" onClick={() => setNewToken(null)}>
            Dismiss
          </button>
        </p>
      )}
      {keys.length === 0 && <p className="hint">No RUM app keys yet.</p>}
      {keys.length > 0 && (
        <ul className="admin-list">
          {keys.map((k) => (
            <li key={k.id}>
              <span>
                <strong>{k.app_name}</strong>
              </span>
              <span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    confirm({
                      title: "Delete RUM app key",
                      message: `Delete the app key for “${k.app_name}”? Beacons using it will stop being accepted.`,
                      onConfirm: () => handleDelete(k),
                    })
                  }
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <input placeholder="App name (e.g. marketing-site)" value={appName} onChange={(e) => setAppName(e.target.value)} required />
        <button type="submit">Create key</button>
      </form>
      {confirmDialog}
    </div>
  );
}
