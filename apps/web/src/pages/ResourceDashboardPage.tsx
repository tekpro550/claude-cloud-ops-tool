import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../lib/apiClient";
import {
  createDowntimeEvent,
  createMonitor,
  deleteMonitor,
  endDowntimeEvent,
  getMonitorChecks,
  getResourceDashboard,
  type MonitorCheck,
} from "../lib/monitoringApiClient";
import { useTenant } from "../lib/tenant";
import type { MonitorType, ResourceDashboard } from "../types/monitoring";
import UptimeHistoryBar from "../components/UptimeHistoryBar";
import { useConfirm } from "../components/useConfirm";

const MONITOR_TYPES: MonitorType[] = ["http", "ping", "port", "dns", "ssl", "server_agent", "cloud_metric"];

/** Per-resource dashboard template (section 6): one page shape reused regardless of resource type. */
export default function ResourceDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const { tenantId } = useTenant();
  const [data, setData] = useState<ResourceDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checksByMonitor, setChecksByMonitor] = useState<Record<string, MonitorCheck[]>>({});
  const { confirm, confirmDialog } = useConfirm();

  const [monitorName, setMonitorName] = useState("");
  const [monitorType, setMonitorType] = useState<MonitorType>("http");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const [downtimeReason, setDowntimeReason] = useState("");

  const load = () => {
    if (!tenantId || !id) return;
    getResourceDashboard(tenantId, id).then((res) => {
      setData(res);
      Promise.all(res.monitors.map((m) => getMonitorChecks(tenantId, m.id, 30).then((checks) => [m.id, checks] as const)))
        .then((pairs) => setChecksByMonitor(Object.fromEntries(pairs)))
        .catch(() => {
          // The history bar is a secondary visual on top of the last_status
          // badge, which already loaded -- a failure here shouldn't block
          // the rest of the page.
        });
    });
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
      <div className="ticket-detail-header">
        <div className="ticket-detail-title">
          <h2>{data.resource.name}</h2>
        </div>
        <div className="ticket-detail-meta">
          <span>{data.resource.resource_type}</span>
          {data.resource.group_name && <span>· {data.resource.group_name}</span>}
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      {data.openDowntime.length > 0 && (
        <div className="alert-card alert-card-warning">
          {data.openDowntime.map((d) => (
            <div key={d.id} className="alert-card-header">
              <span>
                In planned downtime since {new Date(d.starts_at).toLocaleString()}: {d.reason}
              </span>
              <button type="button" className="btn-sm" onClick={() => handleEndDowntime(d.id)}>
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
            <div key={a.id} className={`alert-card alert-card-${a.severity === "critical" ? "critical" : "warning"}`}>
              <div className="alert-card-header">
                <span>
                  <span className={`badge status-${a.severity === "critical" ? "down" : "trouble"}`}>{a.severity}</span>{" "}
                  {a.reason_text}
                </span>
              </div>
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
                <span className={`status-dot status-dot-${m.last_status ?? "none"}`} title={m.last_status ?? "pending"} />
                <span style={{ flex: "1 1 auto" }}>
                  <strong>{m.name}</strong> <span className="hint">({m.monitor_type})</span>
                  {m.last_raw_output?.error ? (
                    <span className="monitor-reason">{String(m.last_raw_output.error)}</span>
                  ) : null}
                </span>
                <UptimeHistoryBar checks={checksByMonitor[m.id] ?? []} />
                <span className={`badge status-${m.last_status ?? "none"}`}>{m.last_status ?? "pending"}</span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    confirm({
                      title: "Delete monitor",
                      message: `Delete the “${m.name}” monitor? Its check history will stop being collected.`,
                      onConfirm: () => handleDeleteMonitor(m.id),
                    })
                  }
                >
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
          <button type="submit" className="btn-primary" disabled={busy}>
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
      {confirmDialog}
    </div>
  );
}
