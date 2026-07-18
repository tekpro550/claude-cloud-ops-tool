import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import { createLogSource, deleteLogSource, listLogSources, updateLogSource } from "../../lib/monitoringApiClient";
import type { LogSource } from "../../types/monitoring";
import { useConfirm } from "../useConfirm";

/** Shows the signed ingest token exactly once, at creation -- see LogsService.createSource, it isn't stored raw server-side. */
export default function LogSourcesAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [sources, setSources] = useState<LogSource[]>([]);
  const [name, setName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const load = () => {
    listLogSources(tenantId).then(setSources);
  };

  useEffect(load, [tenantId]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setError(null);
    createLogSource(tenantId, name.trim())
      .then((created) => {
        setNewToken(created.token ?? null);
        setName("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create log source"));
  };

  const handleToggle = (source: LogSource) => {
    updateLogSource(tenantId, source.id, { isActive: !source.is_active })
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update log source"));
  };

  const handleDelete = (source: LogSource) => {
    deleteLogSource(tenantId, source.id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete log source"));
  };

  return (
    <div className="admin-entity">
      <h4>Log sources</h4>
      <p className="hint">
        Each source gets its own ingest token. Point a log shipper at{" "}
        <code>POST /logs/ingest</code> with <code>Authorization: Bearer &lt;token&gt;</code>.
      </p>
      {error && <p className="error">{error}</p>}
      {newToken && (
        <p className="hint">
          New ingest token (copy it now — it won't be shown again):
          <br />
          <code>{newToken}</code>
          <button type="button" className="link-button" onClick={() => setNewToken(null)}>
            Dismiss
          </button>
        </p>
      )}
      {sources.length === 0 && <p className="hint">No log sources yet.</p>}
      {sources.length > 0 && (
        <ul className="admin-list">
          {sources.map((s) => (
            <li key={s.id}>
              <span>
                <strong>{s.name}</strong> {!s.is_active && <span className="hint">(disabled)</span>}
              </span>
              <span>
                <button type="button" className="link-button" onClick={() => handleToggle(s)}>
                  {s.is_active ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    confirm({
                      title: "Delete log source",
                      message: `Delete “${s.name}”? Its ingest token stops working and all its log entries are removed.`,
                      onConfirm: () => handleDelete(s),
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
        <input placeholder="Source name (e.g. api-prod)" value={name} onChange={(e) => setName(e.target.value)} required />
        <button type="submit">Create source</button>
      </form>
      {confirmDialog}
    </div>
  );
}
