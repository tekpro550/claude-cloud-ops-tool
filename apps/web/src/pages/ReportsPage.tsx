import { useEffect, useState } from "react";
import { getReportsSummary, type ReportsSummary } from "../lib/apiClient";
import { useTenant } from "../lib/tenant";

function fmtMinutes(m: number | null): string {
  if (m === null || m === undefined) return "—";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function fmtPct(v: number | null): string {
  return v === null || v === undefined ? "—" : `${v}%`;
}

/**
 * Ticketing analytics (Freshdesk Analytics parity): SLA attainment,
 * response-time stats, CSAT, ticket volume, and an agent-performance table
 * over a selectable window.
 */
export default function ReportsPage() {
  const { tenantId } = useTenant();
  const [days, setDays] = useState(30);
  const [data, setData] = useState<ReportsSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    getReportsSummary(tenantId, from)
      .then(setData)
      .finally(() => setLoading(false));
  }, [tenantId, days]);

  if (!tenantId) return <p className="hint">Set a tenant id above to view reports.</p>;

  const maxVolume = data ? Math.max(1, ...data.volume.map((v) => Math.max(v.created, v.resolved))) : 1;

  return (
    <div>
      <div className="reports-header">
        <h2>Reports</h2>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>
      {loading && <p className="hint">Loading…</p>}
      {data && (
        <>
          <div className="stat-tiles">
            <div className="stat-tile">
              <span className="stat-label">First-response SLA</span>
              <span className="stat-value">{fmtPct(data.sla.firstResponse.pct)}</span>
              <span className="hint">{data.sla.firstResponse.met}/{data.sla.firstResponse.total} met</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Resolution SLA</span>
              <span className="stat-value">{fmtPct(data.sla.resolution.pct)}</span>
              <span className="hint">{data.sla.resolution.met}/{data.sla.resolution.total} met</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Avg first response</span>
              <span className="stat-value">{fmtMinutes(data.times.firstResponseMinutes.avg)}</span>
              <span className="hint">median {fmtMinutes(data.times.firstResponseMinutes.median)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Avg resolution</span>
              <span className="stat-value">{fmtMinutes(data.times.resolutionMinutes.avg)}</span>
              <span className="hint">median {fmtMinutes(data.times.resolutionMinutes.median)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">CSAT</span>
              <span className="stat-value">{data.csat.score !== null ? `${data.csat.score}` : "—"}</span>
              <span className="hint">{data.csat.total} rating{data.csat.total === 1 ? "" : "s"}</span>
            </div>
          </div>

          <h3>Ticket volume</h3>
          <div className="reports-volume">
            {data.volume.map((v) => (
              <div key={v.day} className="reports-volume-day" title={`${v.day}: ${v.created} created, ${v.resolved} resolved`}>
                <span className="reports-volume-bar reports-volume-created" style={{ height: `${(v.created / maxVolume) * 100}%` }} />
                <span className="reports-volume-bar reports-volume-resolved" style={{ height: `${(v.resolved / maxVolume) * 100}%` }} />
              </div>
            ))}
          </div>
          <p className="hint reports-volume-legend">
            <span className="reports-swatch reports-volume-created" /> Created
            <span className="reports-swatch reports-volume-resolved" /> Resolved
          </p>

          <h3>Agent performance</h3>
          <table className="reports-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Resolved</th>
                <th>Avg resolution</th>
                <th>CSAT</th>
              </tr>
            </thead>
            <tbody>
              {data.agents.length === 0 && (
                <tr><td colSpan={4} className="hint">No agent activity in this window.</td></tr>
              )}
              {data.agents.map((a) => (
                <tr key={a.agent_id}>
                  <td>{a.agent_name}</td>
                  <td>{a.resolved}</td>
                  <td>{fmtMinutes(a.avg_resolution_minutes)}</td>
                  <td>{a.csat_score !== null ? a.csat_score : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
