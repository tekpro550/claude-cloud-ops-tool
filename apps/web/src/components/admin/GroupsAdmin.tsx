import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, createGroup, deleteGroup, listGroups } from "../../lib/apiClient";
import type { Group } from "../../types/ticket";

export default function GroupsAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    listGroups(tenantId).then(setGroups);
  };

  useEffect(load, [tenantId]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    createGroup(tenantId, { name, description: description || undefined })
      .then(() => {
        setName("");
        setDescription("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create group"))
      .finally(() => setBusy(false));
  };

  const handleDelete = (group: Group) => {
    setError(null);
    deleteGroup(tenantId, group.id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete group"));
  };

  return (
    <div className="admin-entity">
      <h4>Groups</h4>
      {error && <p className="error">{error}</p>}
      {groups.length === 0 && <p className="hint">No groups yet.</p>}
      {groups.length > 0 && (
        <ul className="admin-list">
          {groups.map((g) => (
            <li key={g.id}>
              <span>
                <strong>{g.name}</strong>
                {g.description && <span className="hint"> — {g.description}</span>}
              </span>
              <button type="button" className="link-button" onClick={() => handleDelete(g)}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <input placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <button type="submit" disabled={busy}>
          Add group
        </button>
      </form>
    </div>
  );
}
