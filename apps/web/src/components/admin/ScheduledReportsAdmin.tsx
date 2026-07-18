import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import {
  createScheduledReport,
  deleteScheduledReport,
  listScheduledReports,
  runScheduledReportNow,
} from "../../lib/costApiClient";
import type {
  ScheduledReport,
  ScheduledReportCadence,
  ScheduledReportFormat,
  ScheduledReportKind,
} from "../../types/cost";
import { useConfirm } from "../useConfirm";

const REPORT_KINDS: { value: ScheduledReportKind; label: string }[] = [
  { value: "cost_dashboard", label: "Cost dashboard summary" },
  { value: "cost_by_service", label: "Cost by service" },
  { value: "cost_by_tag", label: "Cost by tag" },
  { value: "commitment_coverage", label: "Commitment coverage" },
];

export default function ScheduledReportsAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [reports, setReports] = useState<ScheduledReport[]>([]);
  const [name, setName] = useState("");
  const [reportKind, setReportKind] = useState<ScheduledReportKind>("cost_dashboard");
  const [tagKey, setTagKey] = useState("");
  const [format, setFormat] = useState<ScheduledReportFormat>("csv");
  const [cadence, setCadence] = useState<ScheduledReportCadence>("monthly");
  const [recipients, setRecipients] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const load = () => {
    listScheduledReports(tenantId).then(setReports);
  };

  useEffect(load, [tenantId]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    const recipientList = recipients
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    if (!name.trim() || recipientList.length === 0) return;
    if (reportKind === "cost_by_tag" && !tagKey.trim()) {
      setError("A tag key is required for a cost-by-tag report.");
      return;
    }
    setBusy(true);
    setError(null);
    createScheduledReport(tenantId, {
      name: name.trim(),
      reportKind,
      params: reportKind === "cost_by_tag" ? { tagKey: tagKey.trim() } : undefined,
      format,
      cadence,
      recipients: recipientList,
    })
      .then(() => {
        setName("");
        setTagKey("");
        setRecipients("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create scheduled report"))
      .finally(() => setBusy(false));
  };

  const handleDelete = (report: ScheduledReport) => {
    deleteScheduledReport(tenantId, report.id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete scheduled report"));
  };

  const handleRunNow = (report: ScheduledReport) => {
    setRunningId(report.id);
    setError(null);
    runScheduledReportNow(tenantId, report)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to run report"))
      .finally(() => setRunningId(null));
  };

  return (
    <div className="admin-entity">
      <h4>Scheduled reports</h4>
      <p className="hint">
        Generate a report on a cadence and email it to recipients as a CSV or PDF attachment. Use “Run now” to
        download a copy immediately without waiting for the schedule.
      </p>
      {error && <p className="error">{error}</p>}
      {reports.length === 0 && <p className="hint">No scheduled reports yet.</p>}
      {reports.length > 0 && (
        <ul className="admin-list">
          {reports.map((r) => (
            <li key={r.id}>
              <span>
                <strong>{r.name}</strong>{" "}
                <span className="hint">
                  · {REPORT_KINDS.find((k) => k.value === r.report_kind)?.label ?? r.report_kind} · {r.format.toUpperCase()} ·{" "}
                  {r.cadence} · {r.recipients.join(", ")}
                </span>
                <br />
                <span className="hint">
                  {r.last_run_at ? `Last sent ${new Date(r.last_run_at).toLocaleString()}` : "Never sent"} · Next{" "}
                  {new Date(r.next_run_at).toLocaleString()}
                </span>
              </span>
              <span>
                <button
                  type="button"
                  className="link-button"
                  disabled={runningId === r.id}
                  onClick={() => handleRunNow(r)}
                >
                  {runningId === r.id ? "Running…" : "Run now"}
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    confirm({
                      title: "Delete scheduled report",
                      message: `Delete “${r.name}”? This can't be undone.`,
                      onConfirm: () => handleDelete(r),
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
        <input placeholder="Report name" value={name} onChange={(e) => setName(e.target.value)} required />
        <select value={reportKind} onChange={(e) => setReportKind(e.target.value as ScheduledReportKind)}>
          {REPORT_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        {reportKind === "cost_by_tag" && (
          <input placeholder="Tag key (e.g. team)" value={tagKey} onChange={(e) => setTagKey(e.target.value)} required />
        )}
        <select value={format} onChange={(e) => setFormat(e.target.value as ScheduledReportFormat)}>
          <option value="csv">CSV</option>
          <option value="pdf">PDF</option>
        </select>
        <select value={cadence} onChange={(e) => setCadence(e.target.value as ScheduledReportCadence)}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        <input
          placeholder="Recipients (comma-separated emails)"
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          required
        />
        <button type="submit" disabled={busy}>
          Schedule report
        </button>
      </form>
      {confirmDialog}
    </div>
  );
}
