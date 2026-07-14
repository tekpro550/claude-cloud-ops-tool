import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, createTicketType, deleteTicketType, listGroups, listSlaPolicies, listTicketTypes } from "../../lib/apiClient";
import type { Group, SlaPolicy, TicketType } from "../../types/ticket";

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

  return (
    <div className="admin-entity">
      <h4>Ticket types</h4>
      {error && <p className="error">{error}</p>}
      {ticketTypes.length === 0 && <p className="hint">No ticket types yet.</p>}
      {ticketTypes.length > 0 && (
        <ul className="admin-list">
          {ticketTypes.map((t) => (
            <li key={t.id}>
              <span>
                <strong>{t.name}</strong>{" "}
                <span className="hint">
                  {groupName(t.default_group_id) ? `group: ${groupName(t.default_group_id)}` : "no default group"} ·{" "}
                  {slaName(t.default_sla_policy_id) ? `SLA: ${slaName(t.default_sla_policy_id)}` : "no default SLA"}
                </span>
              </span>
              <button type="button" className="link-button" onClick={() => handleDelete(t)}>
                Delete
              </button>
            </li>
          ))}
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
    </div>
  );
}
