import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, createCannedResponse, deleteCannedResponse, listCannedResponses } from "../../lib/apiClient";
import type { CannedResponse } from "../../types/ticket";

export default function CannedResponsesAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [responses, setResponses] = useState<CannedResponse[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    listCannedResponses(tenantId).then(setResponses);
  };

  useEffect(load, [tenantId]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    setError(null);
    createCannedResponse(tenantId, { title, body })
      .then(() => {
        setTitle("");
        setBody("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create canned response"))
      .finally(() => setBusy(false));
  };

  const handleDelete = (response: CannedResponse) => {
    setError(null);
    deleteCannedResponse(tenantId, response.id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete canned response"));
  };

  return (
    <div className="admin-entity">
      <h4>Canned responses</h4>
      {error && <p className="error">{error}</p>}
      {responses.length === 0 && <p className="hint">No canned responses yet.</p>}
      {responses.length > 0 && (
        <ul className="admin-list">
          {responses.map((r) => (
            <li key={r.id}>
              <span>
                <strong>{r.title}</strong> <span className="hint">{r.body.slice(0, 60)}{r.body.length > 60 ? "…" : ""}</span>
              </span>
              <button type="button" className="link-button" onClick={() => handleDelete(r)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <textarea placeholder="Response body" value={body} onChange={(e) => setBody(e.target.value)} required rows={3} />
        <button type="submit" disabled={busy}>
          Add canned response
        </button>
      </form>
    </div>
  );
}
