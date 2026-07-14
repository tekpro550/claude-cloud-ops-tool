import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ApiError,
  createCannedResponse,
  deleteCannedResponse,
  listCannedResponseFolders,
  listCannedResponses,
  updateCannedResponse,
} from "../../lib/apiClient";
import type { CannedResponse, CannedResponseFolder } from "../../types/ticket";

export default function CannedResponsesAdmin({
  tenantId,
  onChange,
  refreshSignal,
}: {
  tenantId: string;
  onChange?: () => void;
  refreshSignal?: number;
}) {
  const [responses, setResponses] = useState<CannedResponse[]>([]);
  const [folders, setFolders] = useState<CannedResponseFolder[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [folderId, setFolderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editFolderId, setEditFolderId] = useState("");

  const load = () => {
    Promise.all([listCannedResponses(tenantId), listCannedResponseFolders(tenantId)]).then(
      ([responsesRes, foldersRes]) => {
        setResponses(responsesRes);
        setFolders(foldersRes);
      },
    );
  };

  useEffect(load, [tenantId, refreshSignal]);

  const folderName = (id: string | null) => folders.find((f) => f.id === id)?.name ?? null;

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    setError(null);
    createCannedResponse(tenantId, { title, body, folderId: folderId || undefined })
      .then(() => {
        setTitle("");
        setBody("");
        setFolderId("");
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

  const startEdit = (response: CannedResponse) => {
    setEditingId(response.id);
    setEditTitle(response.title);
    setEditBody(response.body);
    setEditFolderId(response.folder_id ?? "");
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = (id: string) => {
    if (!editTitle.trim() || !editBody.trim()) return;
    setError(null);
    updateCannedResponse(tenantId, id, { title: editTitle, body: editBody, folderId: editFolderId || undefined })
      .then(() => {
        setEditingId(null);
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update canned response"));
  };

  return (
    <div className="admin-entity">
      <h4>Canned responses</h4>
      {error && <p className="error">{error}</p>}
      {responses.length === 0 && <p className="hint">No canned responses yet.</p>}
      {responses.length > 0 && (
        <ul className="admin-list">
          {responses.map((r) =>
            editingId === r.id ? (
              <li key={r.id}>
                <span className="admin-form">
                  <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                  <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={3} />
                  <select value={editFolderId} onChange={(e) => setEditFolderId(e.target.value)}>
                    <option value="">No folder</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </span>
                <span>
                  <button type="button" className="link-button" onClick={() => saveEdit(r.id)}>
                    Save
                  </button>
                  <button type="button" className="link-button" onClick={cancelEdit}>
                    Cancel
                  </button>
                </span>
              </li>
            ) : (
              <li key={r.id}>
                <span>
                  <strong>{r.title}</strong>{" "}
                  <span className="hint">
                    {folderName(r.folder_id) ? `${folderName(r.folder_id)} · ` : ""}
                    {r.body.slice(0, 60)}
                    {r.body.length > 60 ? "…" : ""}
                  </span>
                </span>
                <span>
                  <button type="button" className="link-button" onClick={() => startEdit(r)}>
                    Edit
                  </button>
                  <button type="button" className="link-button" onClick={() => handleDelete(r)}>
                    Delete
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <textarea placeholder="Response body" value={body} onChange={(e) => setBody(e.target.value)} required rows={3} />
        <select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
          <option value="">No folder</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy}>
          Add canned response
        </button>
      </form>
    </div>
  );
}
