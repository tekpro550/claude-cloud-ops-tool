import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../lib/apiClient";
import { acknowledgeAlert, listAlerts, resolveAlert } from "../lib/monitoringApiClient";
import { useTenant } from "../lib/tenant";
import type { Alert, AlertStatus } from "../types/monitoring";

const STATUSES: (AlertStatus | "all")[] = ["all", "open", "acknowledged", "resolved"];

export default function AlertsPage() {
  const { tenantId } = useTenant();
  const [status, setStatus] = useState<AlertStatus | "all">("open");
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!tenantId) return;
    listAlerts(tenantId, status === "all" ? undefined : status).then(setAlerts);
  };

  useEffect(load, [tenantId, status]);

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to view alerts.</p>;
  }

  const handleAck = (id: string) => {
    setError(null);
    acknowledgeAlert(tenantId, id)
      .then(load)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to acknowledge alert"));
  };

  const handleResolve = (id: string) => {
    setError(null);
    resolveAlert(tenantId, id)
      .then(load)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to resolve alert"));
  };

  return (
    <div>
      <h2>Alerts</h2>
      <div className="view-tabs">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className={`view-tab${s === status ? " view-tab-active" : ""}`}
            onClick={() => setStatus(s)}
          >
            {s}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {alerts.length === 0 && <p className="hint">No alerts.</p>}
      {alerts.map((a) => (
        <div key={a.id} className={`alert-card alert-card-${a.severity === "critical" ? "critical" : "warning"}`}>
          <div className="alert-card-header">
            <span>
              <span className={`badge status-${a.severity === "critical" ? "down" : "trouble"}`}>{a.severity}</span>{" "}
              <span className="badge">{a.status}</span> {a.reason_text}
            </span>
            <span>
              {a.status === "open" && (
                <button type="button" className="btn-sm" onClick={() => handleAck(a.id)}>
                  Acknowledge
                </button>
              )}
              {a.status !== "resolved" && (
                <button type="button" className="btn-sm btn-primary" onClick={() => handleResolve(a.id)}>
                  Resolve
                </button>
              )}
            </span>
          </div>
          <span className="hint">
            Opened {new Date(a.opened_at).toLocaleString()}
            {a.repeat_count > 0 ? ` · repeated ${a.repeat_count}×` : ""}
            {a.ticket_id ? (
              <>
                {" · "}
                <Link to={`/tickets/${a.ticket_id}`}>View linked ticket</Link>
              </>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}
