import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listSavingsLog } from "../lib/costApiClient";
import { useTenant } from "../lib/tenant";
import type { CostSavingsLogEntry, CostSavingsStatus } from "../types/cost";

const STATUSES: (CostSavingsStatus | "all")[] = ["all", "logged", "verified", "not_materialized"];

function formatMoney(value: number | null): string {
  if (value === null) return "—";
  return `$${Number(value).toFixed(2)}`;
}

/** Expected vs. actual saving per resolved recommendation, status (scope doc section 6). */
export default function SavingsLogPage() {
  const { tenantId } = useTenant();
  const [status, setStatus] = useState<CostSavingsStatus | "all">("all");
  const [entries, setEntries] = useState<CostSavingsLogEntry[]>([]);

  const load = () => {
    if (!tenantId) return;
    listSavingsLog(tenantId, status === "all" ? {} : { status }).then(setEntries);
  };

  useEffect(load, [tenantId, status]);

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to view the savings log.</p>;
  }

  return (
    <div>
      <h2>Savings log</h2>
      <div className="toolbar">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className={s === status ? "" : "link-button"}
            onClick={() => setStatus(s)}
          >
            {s}
          </button>
        ))}
      </div>
      {entries.length === 0 && <p className="hint">No savings logged yet.</p>}
      {entries.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Logged</th>
              <th>Expected/mo</th>
              <th>Actual/mo</th>
              <th>Status</th>
              <th>Ticket</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{new Date(entry.logged_at).toLocaleDateString()}</td>
                <td>{formatMoney(entry.expected_monthly_saving)}</td>
                <td>{formatMoney(entry.actual_monthly_saving)}</td>
                <td>
                  <span className="badge">{entry.status}</span>
                </td>
                <td>
                  {entry.ticket_id ? <Link to={`/tickets/${entry.ticket_id}`}>View ticket</Link> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
