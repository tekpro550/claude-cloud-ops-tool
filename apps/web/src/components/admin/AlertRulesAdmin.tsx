import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import { createAlertRule, deleteAlertRule, listAlertRules, listMonitors } from "../../lib/monitoringApiClient";
import type { AlertRule, Monitor } from "../../types/monitoring";
import { useConfirm } from "../useConfirm";

export default function AlertRulesAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [monitorId, setMonitorId] = useState("");
  const [severity, setSeverity] = useState("critical");
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const load = () => {
    listAlertRules(tenantId).then(setRules);
    listMonitors(tenantId).then(setMonitors);
  };

  useEffect(load, [tenantId]);

  const monitorName = (id: string) => monitors.find((m) => m.id === id)?.name ?? id;

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!monitorId) return;
    setError(null);
    createAlertRule(tenantId, { monitorId, severity })
      .then(() => {
        setMonitorId("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create alert rule"));
  };

  const handleDelete = (id: string) => {
    deleteAlertRule(tenantId, id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete alert rule"));
  };

  return (
    <div className="admin-entity">
      <h4>Alert rules</h4>
      {error && <p className="error">{error}</p>}
      {rules.length === 0 && <p className="hint">No alert rules yet. A monitor without one never opens alerts.</p>}
      {rules.length > 0 && (
        <ul className="admin-list">
          {rules.map((r) => (
            <li key={r.id}>
              <span>
                <strong>{monitorName(r.monitor_id)}</strong> <span className="hint">→ {r.severity}</span>
              </span>
              <span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    confirm({
                      title: "Delete alert rule",
                      message: `Delete the ${r.severity} alert rule on “${monitorName(r.monitor_id)}”? This can't be undone.`,
                      onConfirm: () => handleDelete(r.id),
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
        <select value={monitorId} onChange={(e) => setMonitorId(e.target.value)} required>
          <option value="">Select a monitor…</option>
          {monitors.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="critical">critical</option>
          <option value="warning">warning</option>
          <option value="info">info</option>
        </select>
        <button type="submit">Add alert rule</button>
      </form>
      {confirmDialog}
    </div>
  );
}
