import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../lib/apiClient";
import {
  createDowntimeEvent,
  createMonitor,
  deleteMonitor,
  endDowntimeEvent,
  getResourceDashboard,
} from "../lib/monitoringApiClient";
import { useTenant } from "../lib/tenant";
import type { MonitorType, ResourceDashboard } from "../types/monitoring";

const MONITOR_TYPES: MonitorType[] = ["http", "ping", "port", "dns", "ssl", "server_agent", "cloud_metric"];

/** Per-resource dashboard template (section 6): one page shape reused regardless of resource type. */
export default function ResourceDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const { tenantId } = useTenant();
  const [data, setData] = useState<ResourceDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [monitorName, setMonitorName] = useState("");
  const [monitorType, setMonitorType] = useState<MonitorType>("http");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const [downtimeReason, setDowntimeReason] = useState("");

  const load = () => {
    if (!tenantId || !id) return;
    getResourceDashboard(tenantId, id).then(setData);
  };

  useEffect(load, [tenantId, id]);

  if (!tenantId || !id) {
    return <p className="hint">Set a tenant id above to view this resource.</p>;
  }
  if (!data) {
    return <p className="hint">Loading…</p>;
  }

  const configForType = (type: MonitorType, targetValue: string): Record<string, unknown> => {
    switch (type) {
      case "http":
        return { url: targetValue };
      case "port": {
        const [host, port] = targetValue.split(":");
        return { host, port: Number(port) };
      }
      case "ping":
      case "ssl":
        return { host: targetValue };
      case "dns":
        return { hostname: targetValue };
      default:
        return {};
    }
  };

  const handleAddMonitor = (event: FormEvent) => {
    event.preventDefault();
    if (!monitorName.trim() || !id) return;
    setBusy(true);
    setError(null);
    createMonitor(tenantId, {
      resourceId: id,
      name: monitorName,
      monitorType,
      config: configForType(monitorType, target),
    })
      .then(() => {
        setMonitorName("");
        setTarget("");
        load();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create monitor"))
      .finally(() => setBusy(false));
  };

  const handleDeleteMonitor = (monitorId: string) => {
    deleteMonitor(tenantId, monitorId)
      .then(load)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete monitor"));
  };

  const handleStartDowntime = (event: FormEvent) => {
    event.preventDefault();
    if (!downtimeReason.trim() || !id) return;
    createDowntimeEvent(tenantId, { resourceId: id, reason: downtimeReason })
      .then(() => {
        setDowntimeReason("");
        load();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to start downtime"));
  };

  const handleEndDowntime = (downtimeId: string) => {
    endDowntimeEvent(tenantId, downtimeId)
      .then(load)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to end downtime"));
  };

  const needsTarget = monitorType !== "server_agent" && monitorType !== "cloud_metric";

  return (
    <div>
      <p>
        <Link to="/monitoring">← Fleet status</Link>
      </p>
      <h2>{data.resource.name}</h2>
      <p className="hint">
        {data.resource.resource_type}
        {data.resource.group_name ? ` · ${data.resource.group_name}` : ""}
      </p>
      {error && <p className="error">{error}</p>}

      {data.openDowntime.length > 0 && (
        <div className="alert-card">
          {data.openDowntime.map((d) => (
            <div key={d.id} className="alert-card-header">
              <span>
                In planned downtime since {new Date(d.starts_at).toLocaleString()}: {d.reason}
              </span>
              <button type="button" className="link-button" onClick={() => handleEndDowntime(d.id)}>
                End downtime
              </button>
            </div>
          ))}
        </div>
      )}

      {data.activeAlerts.length > 0 && (
        <section>
          <h3>Active alerts</h3>
          {data.activeAlerts.map((a) => (
            <div key={a.id} className="alert-card">
              <span className={`badge status-${a.severity === "critical" ? "down" : "trouble"}`}>{a.severity}</span>
              <span>{a.reason_text}</span>
            </div>
          ))}
        </section>
      )}

      <section>
        <h3>Monitors</h3>
        {data.monitors.length === 0 && <p className="hint">No monitors on this resource yet.</p>}
        {data.monitors.length > 0 && (
          <ul className="monitor-list">
            {data.monitors.map((m) => (
              <li key={m.id}>
                <span>
                  <span className={`badge status-${m.last_status ?? "none"}`}>{m.last_status ?? "pending"}</span>{" "}
                  <strong>{m.name}</strong> <span className="hint">({m.monitor_type})</span>
                  {m.last_raw_output?.error ? (
                    <span className="monitor-reason">{String(m.last_raw_output.error)}</span>
                  ) : null}
                </span>
                <button type="button" className="link-button" onClick={() => handleDeleteMonitor(m.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}

        <form className="admin-form" onSubmit={handleAddMonitor} style={{ marginTop: "0.75rem" }}>
          <input placeholder="Monitor name" value={monitorName} onChange={(e) => setMonitorName(e.target.value)} required />
          <select value={monitorType} onChange={(e) => setMonitorType(e.target.value as MonitorType)}>
            {MONITOR_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {needsTarget && (
            <input
              placeholder={monitorType === "http" ? "https://example.com" : monitorType === "port" ? "host:port" : "hostname"}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              required
            />
          )}
          <button type="submit" disabled={busy}>
            Add monitor
          </button>
        </form>
      </section>

      <section style={{ marginTop: "1rem" }}>
        <h3>Downtime</h3>
        <form className="admin-form" onSubmit={handleStartDowntime}>
          <input
            placeholder="Reason (e.g. planned maintenance)"
            value={downtimeReason}
            onChange={(e) => setDowntimeReason(e.target.value)}
          />
          <button type="submit">Start downtime</button>
        </form>
      </section>
    </div>
  );
}
