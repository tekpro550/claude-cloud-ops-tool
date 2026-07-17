import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ApiError,
  createCannedResponseFolder,
  deleteCannedResponseFolder,
  listCannedResponseFolders,
  updateCannedResponseFolder,
} from "../../lib/apiClient";
import type { CannedResponseFolder } from "../../types/ticket";
import { useConfirm } from "../useConfirm";

export default function CannedResponseFoldersAdmin({
  tenantId,
  onChange,
}: {
  tenantId: string;
  onChange?: () => void;
}) {
  const [folders, setFolders] = useState<CannedResponseFolder[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const load = () => {
    listCannedResponseFolders(tenantId).then(setFolders);
  };

  useEffect(load, [tenantId]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    createCannedResponseFolder(tenantId, { name })
      .then(() => {
        setName("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create folder"))
      .finally(() => setBusy(false));
  };

  const handleDelete = (folder: CannedResponseFolder) => {
    setError(null);
    deleteCannedResponseFolder(tenantId, folder.id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete folder"));
  };

  const startEdit = (folder: CannedResponseFolder) => {
    setEditingId(folder.id);
    setEditName(folder.name);
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = (id: string) => {
    if (!editName.trim()) return;
    setError(null);
    updateCannedResponseFolder(tenantId, id, { name: editName })
      .then(() => {
        setEditingId(null);
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update folder"));
  };

  return (
    <div className="admin-entity">
      <h4>Canned response folders</h4>
      {error && <p className="error">{error}</p>}
      {folders.length === 0 && <p className="hint">No folders yet.</p>}
      {folders.length > 0 && (
        <ul className="admin-list">
          {folders.map((f) =>
            editingId === f.id ? (
              <li key={f.id}>
                <span className="admin-form">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                </span>
                <span>
                  <button type="button" className="link-button" onClick={() => saveEdit(f.id)}>
                    Save
                  </button>
                  <button type="button" className="link-button" onClick={cancelEdit}>
                    Cancel
                  </button>
                </span>
              </li>
            ) : (
              <li key={f.id}>
                <strong>{f.name}</strong>
                <span>
                  <button type="button" className="link-button" onClick={() => startEdit(f)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() =>
                      confirm({
                        title: "Delete folder",
                        message: `Delete the folder “${f.name}”? This can't be undone.`,
                        onConfirm: () => handleDelete(f),
                      })
                    }
                  >
                    Delete
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <input placeholder="Folder name" value={name} onChange={(e) => setName(e.target.value)} required />
        <button type="submit" disabled={busy}>
          Add folder
        </button>
      </form>
      {confirmDialog}
    </div>
  );
}
