import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import { createApmIngestKey, deleteApmIngestKey, listApmIngestKeys } from "../../lib/monitoringApiClient";
import type { ApmIngestKey } from "../../types/monitoring";
import { useConfirm } from "../useConfirm";

/** Shows the signed ingest key exactly once, at creation -- see ApmService.createIngestKey. */
export default function ApmIngestKeysAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [keys, setKeys] = useState<ApmIngestKey[]>([]);
  const [service, setService] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const load = () => {
    listApmIngestKeys(tenantId).then(setKeys);
  };

  useEffect(load, [tenantId]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!service.trim()) return;
    setError(null);
    createApmIngestKey(tenantId, service.trim())
      .then((created) => {
        setNewToken(created.token ?? null);
        setService("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create APM ingest key"));
  };

  const handleDelete = (key: ApmIngestKey) => {
    deleteApmIngestKey(tenantId, key.id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete APM ingest key"));
  };

  return (
    <div className="admin-entity">
      <h4>APM ingest keys</h4>
      <p className="hint">
        One key per service. Send traces to <code>POST /apm/traces</code> with{" "}
        <code>Authorization: Bearer &lt;key&gt;</code> — see <code>docs/apm-rum-integration.md</code>.
      </p>
      {error && <p className="error">{error}</p>}
      {newToken && (
        <p className="hint">
          New ingest key (copy it now — it won't be shown again):
          <br />
          <code>{newToken}</code>
          <button type="button" className="link-button" onClick={() => setNewToken(null)}>
            Dismiss
          </button>
        </p>
      )}
      {keys.length === 0 && <p className="hint">No APM ingest keys yet.</p>}
      {keys.length > 0 && (
        <ul className="admin-list">
          {keys.map((k) => (
            <li key={k.id}>
              <span>
                <strong>{k.service}</strong>
              </span>
              <span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    confirm({
                      title: "Delete APM ingest key",
                      message: `Delete the ingest key for “${k.service}”? Traces from it will stop being accepted.`,
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
        <input placeholder="Service name (e.g. checkout-api)" value={service} onChange={(e) => setService(e.target.value)} required />
        <button type="submit">Create key</button>
      </form>
      {confirmDialog}
    </div>
  );
}
