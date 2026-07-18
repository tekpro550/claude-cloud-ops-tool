import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import { createAlertRule, deleteAlertRule, listAlertRules, listMonitors } from "../../lib/monitoringApiClient";
import type { AlertMetric, AlertRule, AlertRuleKind, Monitor, MetricComparator } from "../../types/monitoring";
import { useConfirm } from "../useConfirm";

const RULE_KINDS: { value: AlertRuleKind; label: string }[] = [
  { value: "status", label: "Status (up/down)" },
  { value: "threshold", label: "Metric threshold" },
  { value: "anomaly", label: "Metric anomaly" },
];

const METRICS: { value: AlertMetric; label: string }[] = [
  { value: "response_time_ms", label: "Response time (ms)" },
  { value: "cpu_percent", label: "CPU %" },
  { value: "mem_percent", label: "Memory %" },
  { value: "disk_percent", label: "Disk %" },
  { value: "cloud_metric_value", label: "Cloud metric value" },
];

const COMPARATORS: { value: MetricComparator; label: string }[] = [
  { value: "gt", label: "> greater than" },
  { value: "gte", label: "≥ greater or equal" },
  { value: "lt", label: "< less than" },
  { value: "lte", label: "≤ less or equal" },
];

export default function AlertRulesAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [monitorId, setMonitorId] = useState("");
  const [severity, setSeverity] = useState("critical");
  const [ruleKind, setRuleKind] = useState<AlertRuleKind>("status");
  const [metric, setMetric] = useState<AlertMetric>("response_time_ms");
  const [comparator, setComparator] = useState<MetricComparator>("gt");
  const [threshold, setThreshold] = useState("");
  const [forConsecutive, setForConsecutive] = useState("1");
  const [anomalySensitivity, setAnomalySensitivity] = useState("3");
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const load = () => {
    listAlertRules(tenantId).then(setRules);
    listMonitors(tenantId).then(setMonitors);
  };

  useEffect(load, [tenantId]);

  const monitorName = (id: string) => monitors.find((m) => m.id === id)?.name ?? id;

  const ruleSummary = (r: AlertRule) => {
    if (r.rule_kind === "threshold") {
      return `${r.metric} ${r.comparator} ${r.threshold} × ${r.for_consecutive}`;
    }
    if (r.rule_kind === "anomaly") {
      return `${r.metric} anomaly (sensitivity ${r.anomaly_sensitivity})`;
    }
    return "status up/down";
  };

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!monitorId) return;
    setError(null);
    createAlertRule(tenantId, {
      monitorId,
      severity,
      ruleKind,
      metric: ruleKind === "status" ? undefined : metric,
      comparator: ruleKind === "threshold" ? comparator : undefined,
      threshold: ruleKind === "threshold" ? Number(threshold) : undefined,
      forConsecutive: ruleKind === "status" ? undefined : Number(forConsecutive) || 1,
      anomalySensitivity: ruleKind === "anomaly" ? Number(anomalySensitivity) : undefined,
    })
      .then(() => {
        setMonitorId("");
        setThreshold("");
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
      <p className="hint">
        Status rules watch up/down transitions. Threshold and anomaly rules watch a numeric metric from check
        history instead.
      </p>
      {error && <p className="error">{error}</p>}
      {rules.length === 0 && <p className="hint">No alert rules yet. A monitor without one never opens alerts.</p>}
      {rules.length > 0 && (
        <ul className="admin-list">
          {rules.map((r) => (
            <li key={r.id}>
              <span>
                <strong>{monitorName(r.monitor_id)}</strong>{" "}
                <span className="hint">
                  → {r.severity} · {ruleSummary(r)}
                </span>
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
        <select value={ruleKind} onChange={(e) => setRuleKind(e.target.value as AlertRuleKind)}>
          {RULE_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>

        {ruleKind !== "status" && (
          <select value={metric} onChange={(e) => setMetric(e.target.value as AlertMetric)}>
            {METRICS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        )}

        {ruleKind === "threshold" && (
          <>
            <select value={comparator} onChange={(e) => setComparator(e.target.value as MetricComparator)}>
              {COMPARATORS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              placeholder="Threshold"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              required
            />
          </>
        )}

        {ruleKind === "anomaly" && (
          <input
            type="number"
            step="0.1"
            min="0.1"
            placeholder="Sensitivity (std devs)"
            value={anomalySensitivity}
            onChange={(e) => setAnomalySensitivity(e.target.value)}
          />
        )}

        {ruleKind !== "status" && (
          <input
            type="number"
            min="1"
            placeholder="Consecutive checks"
            value={forConsecutive}
            onChange={(e) => setForConsecutive(e.target.value)}
          />
        )}

        <button type="submit">Add alert rule</button>
      </form>
      {confirmDialog}
    </div>
  );
}
