import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import { createOnCallSchedule, deleteOnCallSchedule, listOnCallSchedules } from "../../lib/monitoringApiClient";
import type { OnCallSchedule } from "../../types/monitoring";

const ENTRIES_PLACEHOLDER = JSON.stringify(
  [{ agentId: "<agent id>", startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 7 * 86400_000).toISOString() }],
  null,
  2,
);

export default function OnCallSchedulesAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [schedules, setSchedules] = useState<OnCallSchedule[]>([]);
  const [name, setName] = useState("");
  const [entriesJson, setEntriesJson] = useState(ENTRIES_PLACEHOLDER);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    listOnCallSchedules(tenantId).then(setSchedules);
  };

  useEffect(load, [tenantId]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    let entries: OnCallSchedule["entries"];
    try {
      entries = JSON.parse(entriesJson);
    } catch {
      setError("Entries must be valid JSON");
      return;
    }
    setError(null);
    createOnCallSchedule(tenantId, { name, entries })
      .then(() => {
        setName("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create on-call schedule"));
  };

  const handleDelete = (id: string) => {
    deleteOnCallSchedule(tenantId, id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete on-call schedule"));
  };

  return (
    <div className="admin-entity">
      <h4>On-call schedules</h4>
      {error && <p className="error">{error}</p>}
      {schedules.length === 0 && <p className="hint">No on-call schedules yet.</p>}
      {schedules.length > 0 && (
        <ul className="admin-list">
          {schedules.map((s) => (
            <li key={s.id}>
              <span>
                <strong>{s.name}</strong> <span className="hint">— {s.entries.length} entr{s.entries.length === 1 ? "y" : "ies"}</span>
              </span>
              <span>
                <button type="button" className="link-button" onClick={() => handleDelete(s.id)}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <input placeholder="Schedule name" value={name} onChange={(e) => setName(e.target.value)} required />
        <textarea
          rows={5}
          style={{ width: "100%", fontFamily: "monospace" }}
          value={entriesJson}
          onChange={(e) => setEntriesJson(e.target.value)}
        />
        <button type="submit">Create schedule</button>
      </form>
    </div>
  );
}
