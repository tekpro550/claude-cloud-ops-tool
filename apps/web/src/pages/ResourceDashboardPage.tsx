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
import type { MonitorType, ResourceDashboard, SyntheticAction, SyntheticStep, SyntheticStepResult } from "../types/monitoring";
import UptimeHistoryBar from "../components/UptimeHistoryBar";
import SyntheticWaterfall from "../components/SyntheticWaterfall";
import { useConfirm } from "../components/useConfirm";

const MONITOR_TYPES: MonitorType[] = ["http", "ping", "port", "dns", "ssl", "server_agent", "cloud_metric", "synthetic"];
const SYNTHETIC_ACTIONS: SyntheticAction[] = ["goto", "click", "fill", "expectText"];
const emptyStep = (): SyntheticStep => ({ action: "goto", url: "" });

/** Per-resource dashboard template (section 6): one page shape reused regardless of resource type. */
export default function ResourceDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const { tenantId } = useTenant();
  const [data, setData] = useState<ResourceDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checksByMonitor, setChecksByMonitor] = useState<Record<string, MonitorCheck[]>>({});
  const { confirm, confirmDialog } = useConfirm();

  const [monitorName, setMonitorName] = useState("");
  const [minLocations, setMinLocations] = useState("1");
  const [monitorType, setMonitorType] = useState<MonitorType>("http");
  const [target, setTarget] = useState("");
  const [syntheticSteps, setSyntheticSteps] = useState<SyntheticStep[]>([emptyStep()]);
  const [maxStepMs, setMaxStepMs] = useState("15000");
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
      case "synthetic":
        return {
          steps: syntheticSteps.map((s) =>
            s.action === "goto" ? { action: s.action, url: s.url } : { action: s.action, selector: s.selector, value: s.value },
          ),
          maxStepMs: Number(maxStepMs) || undefined,
        };
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
      minFailingLocations: Number(minLocations) || 1,
    })
      .then(() => {
        setMonitorName("");
        setTarget("");
        setSyntheticSteps([emptyStep()]);
        load();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create monitor"))
      .finally(() => setBusy(false));
  };

  const updateStep = (index: number, patch: Partial<SyntheticStep>) => {
    setSyntheticSteps((steps) => steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };
  const addStep = () => setSyntheticSteps((steps) => [...steps, emptyStep()]);
  const removeStep = (index: number) => setSyntheticSteps((steps) => steps.filter((_, i) => i !== index));

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

  const needsTarget = monitorType !== "server_agent" && monitorType !== "cloud_metric" && monitorType !== "synthetic";

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
              <li key={m.id} className={m.monitor_type === "synthetic" ? "monitor-list-item-synthetic" : undefined}>
                <span className={`status-dot status-dot-${m.last_status ?? "none"}`} title={m.last_status ?? "pending"} />
                <span style={{ flex: "1 1 auto" }}>
                  <strong>{m.name}</strong> <span className="hint">({m.monitor_type})</span>
                  {m.last_raw_output?.error ? (
                    <span className="monitor-reason">{String(m.last_raw_output.error)}</span>
                  ) : null}
                  {m.monitor_type === "synthetic" && Array.isArray(m.last_raw_output?.steps) && (
                    <SyntheticWaterfall
                      steps={m.last_raw_output.steps as SyntheticStepResult[]}
                      failingStepIndex={m.last_raw_output.failingStepIndex as number | null | undefined}
                    />
                  )}
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
          <label className="side-panel-toggle" title="How many probe locations must fail before an alert opens (multi-region false-positive suppression)">
            Min failing locations
            <input
              type="number"
              min={1}
              value={minLocations}
              onChange={(e) => setMinLocations(e.target.value)}
              style={{ width: "4rem" }}
            />
          </label>
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
          {monitorType === "synthetic" && (
            <div className="synthetic-step-builder">
              {syntheticSteps.map((step, index) => (
                <div key={index} className="synthetic-step-row">
                  <span className="hint">{index + 1}.</span>
                  <select value={step.action} onChange={(e) => updateStep(index, { action: e.target.value as SyntheticAction })}>
                    {SYNTHETIC_ACTIONS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  {step.action === "goto" ? (
                    <input
                      placeholder="https://example.com/login"
                      value={step.url ?? ""}
                      onChange={(e) => updateStep(index, { url: e.target.value })}
                    />
                  ) : (
                    <input
                      placeholder="CSS selector, e.g. #submit"
                      value={step.selector ?? ""}
                      onChange={(e) => updateStep(index, { selector: e.target.value })}
                    />
                  )}
                  {(step.action === "fill" || step.action === "expectText") && (
                    <input
                      placeholder="value"
                      value={step.value ?? ""}
                      onChange={(e) => updateStep(index, { value: e.target.value })}
                    />
                  )}
                  {syntheticSteps.length > 1 && (
                    <button type="button" className="link-button" onClick={() => removeStep(index)}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button type="button" className="link-button" onClick={addStep}>
                + Add step
              </button>
              <label className="side-panel-toggle" title="Fail a step (and the whole run) if it takes longer than this">
                Max step ms
                <input type="number" min={1000} value={maxStepMs} onChange={(e) => setMaxStepMs(e.target.value)} style={{ width: "5rem" }} />
              </label>
            </div>
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
