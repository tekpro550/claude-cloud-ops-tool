import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ApiError,
  createTicketType,
  deleteTicketType,
  listGroups,
  listSlaPolicies,
  listTicketTypes,
  updateTicketType,
} from "../../lib/apiClient";
import type { Group, SlaPolicy, TicketType } from "../../types/ticket";
import { useConfirm } from "../useConfirm";

export default function TicketTypesAdmin({
  tenantId,
  onChange,
  refreshSignal,
}: {
  tenantId: string;
  onChange?: () => void;
  refreshSignal?: number;
}) {
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [slaPolicies, setSlaPolicies] = useState<SlaPolicy[]>([]);
  const [name, setName] = useState("");
  const [defaultGroupId, setDefaultGroupId] = useState("");
  const [defaultSlaPolicyId, setDefaultSlaPolicyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDefaultGroupId, setEditDefaultGroupId] = useState("");
  const [editDefaultSlaPolicyId, setEditDefaultSlaPolicyId] = useState("");

  const load = () => {
    Promise.all([listTicketTypes(tenantId), listGroups(tenantId), listSlaPolicies(tenantId)]).then(
      ([typesRes, groupsRes, slaRes]) => {
        setTicketTypes(typesRes);
        setGroups(groupsRes);
        setSlaPolicies(slaRes);
      },
    );
  };

  useEffect(load, [tenantId, refreshSignal]);

  const groupName = (id: string | null) => groups.find((g) => g.id === id)?.name ?? null;
  const slaName = (id: string | null) => slaPolicies.find((s) => s.id === id)?.name ?? null;

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    createTicketType(tenantId, {
      name,
      defaultGroupId: defaultGroupId || undefined,
      defaultSlaPolicyId: defaultSlaPolicyId || undefined,
    })
      .then(() => {
        setName("");
        setDefaultGroupId("");
        setDefaultSlaPolicyId("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create ticket type"))
      .finally(() => setBusy(false));
  };

  const handleDelete = (ticketType: TicketType) => {
    setError(null);
    deleteTicketType(tenantId, ticketType.id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete ticket type"));
  };

  const startEdit = (ticketType: TicketType) => {
    setEditingId(ticketType.id);
    setEditName(ticketType.name);
    setEditDefaultGroupId(ticketType.default_group_id ?? "");
    setEditDefaultSlaPolicyId(ticketType.default_sla_policy_id ?? "");
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = (id: string) => {
    if (!editName.trim()) return;
    setError(null);
    updateTicketType(tenantId, id, {
      name: editName,
      defaultGroupId: editDefaultGroupId || undefined,
      defaultSlaPolicyId: editDefaultSlaPolicyId || undefined,
    })
      .then(() => {
        setEditingId(null);
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update ticket type"));
  };

  return (
    <div className="admin-entity">
      <h4>Ticket types</h4>
      {error && <p className="error">{error}</p>}
      {ticketTypes.length === 0 && <p className="hint">No ticket types yet.</p>}
      {ticketTypes.length > 0 && (
        <ul className="admin-list">
          {ticketTypes.map((t) =>
            editingId === t.id ? (
              <li key={t.id}>
                <span className="admin-form">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <select value={editDefaultGroupId} onChange={(e) => setEditDefaultGroupId(e.target.value)}>
                    <option value="">No default group</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                  <select value={editDefaultSlaPolicyId} onChange={(e) => setEditDefaultSlaPolicyId(e.target.value)}>
                    <option value="">No default SLA</option>
                    {slaPolicies.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </span>
                <span>
                  <button type="button" className="link-button" onClick={() => saveEdit(t.id)}>
                    Save
                  </button>
                  <button type="button" className="link-button" onClick={cancelEdit}>
                    Cancel
                  </button>
                </span>
              </li>
            ) : (
              <li key={t.id}>
                <span>
                  <strong>{t.name}</strong>{" "}
                  <span className="hint">
                    {groupName(t.default_group_id) ? `group: ${groupName(t.default_group_id)}` : "no default group"} ·{" "}
                    {slaName(t.default_sla_policy_id) ? `SLA: ${slaName(t.default_sla_policy_id)}` : "no default SLA"}
                  </span>
                </span>
                <span>
                  <button type="button" className="link-button" onClick={() => startEdit(t)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() =>
                      confirm({
                        title: "Delete ticket type",
                        message: `Delete the ticket type “${t.name}”? This can't be undone.`,
                        onConfirm: () => handleDelete(t),
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
        <input placeholder="Ticket type name" value={name} onChange={(e) => setName(e.target.value)} required />
        <select value={defaultGroupId} onChange={(e) => setDefaultGroupId(e.target.value)}>
          <option value="">No default group</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select value={defaultSlaPolicyId} onChange={(e) => setDefaultSlaPolicyId(e.target.value)}>
          <option value="">No default SLA</option>
          {slaPolicies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy}>
          Add ticket type
        </button>
      </form>
      {confirmDialog}
    </div>
  );
}
