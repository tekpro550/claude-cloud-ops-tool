import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import { createCloudCredential, deleteCloudCredential, listCloudCredentials } from "../../lib/monitoringApiClient";
import type { CloudCredential, CloudProvider } from "../../types/monitoring";
import { useConfirm } from "../useConfirm";

/** config is never re-displayed once submitted -- see CloudCredentialsService, it's write-only from here on. */
export default function CloudCredentialsAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [credentials, setCredentials] = useState<CloudCredential[]>([]);
  const [provider, setProvider] = useState<CloudProvider>("aws");
  const [label, setLabel] = useState("");
  const [configJson, setConfigJson] = useState('{\n  "region": "us-east-1",\n  "accessKeyId": "",\n  "secretAccessKey": ""\n}');
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const load = () => {
    listCloudCredentials(tenantId).then(setCredentials);
  };

  useEffect(load, [tenantId]);

  const configPlaceholder = (p: CloudProvider) =>
    p === "aws"
      ? '{\n  "region": "us-east-1",\n  "accessKeyId": "",\n  "secretAccessKey": ""\n}'
      : '{\n  "subscriptionId": "",\n  "tenantId": "",\n  "clientId": "",\n  "clientSecret": ""\n}';

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim()) return;
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(configJson);
    } catch {
      setError("Config must be valid JSON");
      return;
    }
    setError(null);
    createCloudCredential(tenantId, { provider, label, config })
      .then(() => {
        setLabel("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create cloud credential"));
  };

  const handleDelete = (id: string) => {
    deleteCloudCredential(tenantId, id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete cloud credential"));
  };

  return (
    <div className="admin-entity">
      <h4>Cloud credentials</h4>
      {error && <p className="error">{error}</p>}
      {credentials.length === 0 && <p className="hint">No cloud accounts connected yet.</p>}
      {credentials.length > 0 && (
        <ul className="admin-list">
          {credentials.map((c) => (
            <li key={c.id}>
              <span>
                <strong>{c.label}</strong> <span className="hint">({c.provider})</span>{" "}
                {c.last_polled_at ? (
                  <span className="hint">· last polled {new Date(c.last_polled_at).toLocaleString()}</span>
                ) : (
                  <span className="hint">· not polled yet</span>
                )}
              </span>
              <span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    confirm({
                      title: "Delete cloud credential",
                      message: `Delete the ${c.provider} credential “${c.label}”? Monitoring and cost polling for it will stop.`,
                      onConfirm: () => handleDelete(c.id),
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
        <select
          value={provider}
          onChange={(e) => {
            const next = e.target.value as CloudProvider;
            setProvider(next);
            setConfigJson(configPlaceholder(next));
          }}
        >
          <option value="aws">aws</option>
          <option value="azure">azure</option>
        </select>
        <input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} required />
        <textarea
          rows={4}
          style={{ width: "100%", fontFamily: "monospace" }}
          value={configJson}
          onChange={(e) => setConfigJson(e.target.value)}
        />
        <button type="submit">Connect</button>
      </form>
      {confirmDialog}
    </div>
  );
}
