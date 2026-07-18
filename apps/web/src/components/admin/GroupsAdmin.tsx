import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, createGroup, deleteGroup, listGroups, updateGroup } from "../../lib/apiClient";
import type { AssignmentStrategy, Group } from "../../types/ticket";
import { useConfirm } from "../useConfirm";

const STRATEGIES: { value: AssignmentStrategy; label: string }[] = [
  { value: "manual", label: "Manual (no auto-assign)" },
  { value: "round_robin", label: "Round robin" },
  { value: "load_based", label: "Load based (fewest open tickets)" },
  { value: "skill_based", label: "Skill based" },
];

export default function GroupsAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [strategy, setStrategy] = useState<AssignmentStrategy>("manual");
  const [maxOpen, setMaxOpen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStrategy, setEditStrategy] = useState<AssignmentStrategy>("manual");
  const [editMaxOpen, setEditMaxOpen] = useState("");

  const load = () => {
    listGroups(tenantId).then(setGroups);
  };

  useEffect(load, [tenantId]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    createGroup(tenantId, {
      name,
      description: description || undefined,
      assignmentStrategy: strategy,
      maxOpenTicketsPerAgent: maxOpen ? Number(maxOpen) : undefined,
    })
      .then(() => {
        setName("");
        setDescription("");
        setStrategy("manual");
        setMaxOpen("");
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

  const startEdit = (group: Group) => {
    setEditingId(group.id);
    setEditName(group.name);
    setEditDescription(group.description ?? "");
    setEditStrategy(group.assignment_strategy);
    setEditMaxOpen(group.max_open_tickets_per_agent ? String(group.max_open_tickets_per_agent) : "");
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = (id: string) => {
    if (!editName.trim()) return;
    setError(null);
    updateGroup(tenantId, id, {
      name: editName,
      description: editDescription || undefined,
      assignmentStrategy: editStrategy,
      maxOpenTicketsPerAgent: editMaxOpen ? Number(editMaxOpen) : null,
    })
      .then(() => {
        setEditingId(null);
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update group"));
  };

  const strategyLabel = (value: AssignmentStrategy) => STRATEGIES.find((s) => s.value === value)?.label ?? value;

  return (
    <div className="admin-entity">
      <h4>Groups</h4>
      <p className="hint">
        A group's assignment strategy decides who a new ticket routed there is handed to. Skill-based routing draws
        on the skills configured under Agent skills.
      </p>
      {error && <p className="error">{error}</p>}
      {groups.length === 0 && <p className="hint">No groups yet.</p>}
      {groups.length > 0 && (
        <ul className="admin-list">
          {groups.map((g) =>
            editingId === g.id ? (
              <li key={g.id}>
                <span className="admin-form">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <input placeholder="Description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
                  <select value={editStrategy} onChange={(e) => setEditStrategy(e.target.value as AssignmentStrategy)}>
                    {STRATEGIES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  {editStrategy !== "manual" && (
                    <input
                      type="number"
                      min={1}
                      placeholder="Max open per agent (optional)"
                      value={editMaxOpen}
                      onChange={(e) => setEditMaxOpen(e.target.value)}
                    />
                  )}
                </span>
                <span>
                  <button type="button" className="link-button" onClick={() => saveEdit(g.id)}>
                    Save
                  </button>
                  <button type="button" className="link-button" onClick={cancelEdit}>
                    Cancel
                  </button>
                </span>
              </li>
            ) : (
              <li key={g.id}>
                <span>
                  <strong>{g.name}</strong>
                  {g.description && <span className="hint"> — {g.description}</span>}
                  <span className="hint">
                    {" "}
                    · {strategyLabel(g.assignment_strategy)}
                    {g.max_open_tickets_per_agent ? ` (cap ${g.max_open_tickets_per_agent})` : ""}
                  </span>
                </span>
                <span>
                  <button type="button" className="link-button" onClick={() => startEdit(g)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() =>
                      confirm({
                        title: "Delete group",
                        message: `Delete “${g.name}”? This can't be undone.`,
                        onConfirm: () => handleDelete(g),
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
        <input placeholder="Group name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <select value={strategy} onChange={(e) => setStrategy(e.target.value as AssignmentStrategy)}>
          {STRATEGIES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {strategy !== "manual" && (
          <input
            type="number"
            min={1}
            placeholder="Max open per agent (optional)"
            value={maxOpen}
            onChange={(e) => setMaxOpen(e.target.value)}
          />
        )}
        <button type="submit" disabled={busy}>
          Add group
        </button>
      </form>
      {confirmDialog}
    </div>
  );
}
