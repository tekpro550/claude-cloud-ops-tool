import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ApiError,
  createReportDefinition,
  deleteReportDefinition,
  listReportDefinitions,
  previewReportDefinition,
  runReportDefinition,
  REPORT_DIMENSIONS,
  REPORT_METRICS,
} from "../lib/apiClient";
import type { ReportConfig, ReportDefinition, ReportDimension, ReportMetric, ReportRow } from "../lib/apiClient";
import { useConfirm } from "./useConfirm";

const METRIC_LABELS: Record<ReportMetric, string> = {
  ticket_count: "Ticket count",
  avg_first_response_minutes: "Avg first response (min)",
  avg_resolution_minutes: "Avg resolution (min)",
  sla_attainment_pct: "SLA attainment %",
  avg_csat: "Avg CSAT",
};

const DIMENSION_LABELS: Record<ReportDimension, string> = {
  status: "Status",
  priority: "Priority",
  ticket_type_id: "Ticket type",
  group_id: "Group",
  assignee_id: "Assignee",
  source: "Source",
  day: "Day",
  week: "Week",
  month: "Month",
};

function formatValue(v: string | number | null): string {
  if (v === null || v === undefined) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : String(v);
}

/**
 * Freshdesk-style custom report builder: pick a metric + a group-by
 * dimension (plus an optional filter), preview the result, and optionally
 * save it as a named, re-runnable definition.
 */
export default function CustomReportBuilder({ tenantId }: { tenantId: string }) {
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [metric, setMetric] = useState<ReportMetric>("ticket_count");
  const [groupBy, setGroupBy] = useState<ReportDimension>("status");
  const [filterField, setFilterField] = useState<ReportDimension | "">("");
  const [filterValue, setFilterValue] = useState("");
  const [name, setName] = useState("");
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  const load = () => {
    listReportDefinitions(tenantId).then(setDefinitions);
  };

  useEffect(load, [tenantId]);

  const buildConfig = (): ReportConfig => ({
    metric,
    groupBy,
    filters: filterField && filterValue.trim() ? [{ field: filterField, value: filterValue.trim() }] : undefined,
  });

  const handlePreview = () => {
    setBusy(true);
    setError(null);
    previewReportDefinition(tenantId, buildConfig())
      .then((r) => {
        setRows(r);
        setActiveLabel(`${METRIC_LABELS[metric]} by ${DIMENSION_LABELS[groupBy]}`);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to run report"))
      .finally(() => setBusy(false));
  };

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    createReportDefinition(tenantId, { name: name.trim(), config: buildConfig() })
      .then(() => {
        setName("");
        load();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to save report"))
      .finally(() => setBusy(false));
  };

  const handleRun = (def: ReportDefinition) => {
    setBusy(true);
    setError(null);
    runReportDefinition(tenantId, def.id)
      .then(({ rows: r }) => {
        setRows(r);
        setActiveLabel(def.name);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to run report"))
      .finally(() => setBusy(false));
  };

  const handleDelete = (def: ReportDefinition) => {
    deleteReportDefinition(tenantId, def.id)
      .then(load)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete report"));
  };

  return (
    <div className="admin-entity">
      <h3>Custom report builder</h3>
      <p className="hint">Pick a metric, group it by a dimension, optionally filter, then preview or save it to re-run later.</p>
      {error && <p className="error">{error}</p>}

      <div className="admin-form">
        <select value={metric} onChange={(e) => setMetric(e.target.value as ReportMetric)}>
          {REPORT_METRICS.map((m) => (
            <option key={m} value={m}>
              {METRIC_LABELS[m]}
            </option>
          ))}
        </select>
        <span className="hint">by</span>
        <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as ReportDimension)}>
          {REPORT_DIMENSIONS.map((d) => (
            <option key={d} value={d}>
              {DIMENSION_LABELS[d]}
            </option>
          ))}
        </select>
        <select value={filterField} onChange={(e) => setFilterField(e.target.value as ReportDimension | "")}>
          <option value="">No filter</option>
          {REPORT_DIMENSIONS.map((d) => (
            <option key={d} value={d}>
              filter: {DIMENSION_LABELS[d]}
            </option>
          ))}
        </select>
        {filterField && (
          <input
            placeholder="Filter value"
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
          />
        )}
        <button type="button" disabled={busy} onClick={handlePreview}>
          Preview
        </button>
      </div>

      {rows && (
        <>
          <h4>{activeLabel}</h4>
          <table className="reports-table">
            <thead>
              <tr>
                <th>Bucket</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={2} className="hint">
                    No data for this combination.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.bucket}>
                  <td>{r.bucket}</td>
                  <td>{formatValue(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <form className="admin-form" onSubmit={handleSave}>
        <input placeholder="Save as…" value={name} onChange={(e) => setName(e.target.value)} required />
        <button type="submit" disabled={busy}>
          Save report
        </button>
      </form>

      {definitions.length > 0 && (
        <ul className="admin-list">
          {definitions.map((d) => (
            <li key={d.id}>
              <span>
                <strong>{d.name}</strong>{" "}
                <span className="hint">
                  · {METRIC_LABELS[d.config.metric]} by {DIMENSION_LABELS[d.config.groupBy]}
                </span>
              </span>
              <span>
                <button type="button" className="link-button" disabled={busy} onClick={() => handleRun(d)}>
                  Run
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    confirm({
                      title: "Delete saved report",
                      message: `Delete “${d.name}”? This can't be undone.`,
                      onConfirm: () => handleDelete(d),
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
      {confirmDialog}
    </div>
  );
}
