import { useEffect, useState } from "react";
import {
  getApmServiceStats,
  getApmSlowestTraces,
  getApmTrace,
  listApmServices,
} from "../lib/monitoringApiClient";
import type { ApmServiceStats, ApmServiceSummary, ApmSpan, ApmTrace } from "../types/monitoring";
import { useTenant } from "../lib/tenant";
import ApmSpanWaterfall from "../components/ApmSpanWaterfall";

function fmtMs(n: number): string {
  return `${Math.round(n)}ms`;
}

/**
 * Site24x7 APM Insight-style dashboard: service list -> per-transaction
 * latency percentiles + apdex -> slowest traces -> a span waterfall for
 * whichever trace is selected.
 */
export default function ApmDashboardPage() {
  const { tenantId } = useTenant();
  const [services, setServices] = useState<ApmServiceSummary[]>([]);
  const [service, setService] = useState("");
  const [stats, setStats] = useState<ApmServiceStats | null>(null);
  const [slowest, setSlowest] = useState<ApmTrace[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<{ trace: ApmTrace; spans: ApmSpan[] } | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    listApmServices(tenantId).then((s) => {
      setServices(s);
      if (!service && s.length > 0) setService(s[0].service);
    });
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || !service) return;
    setSelectedTrace(null);
    getApmServiceStats(tenantId, service).then(setStats);
    getApmSlowestTraces(tenantId, service, 10).then(setSlowest);
  }, [tenantId, service]);

  const openTrace = (traceId: string) => {
    if (!tenantId) return;
    getApmTrace(tenantId, traceId).then(setSelectedTrace);
  };

  if (!tenantId) return <p className="hint">Set a tenant id above to view APM.</p>;

  return (
    <div>
      <div className="reports-header">
        <h2>APM</h2>
        {services.length > 0 && (
          <select value={service} onChange={(e) => setService(e.target.value)}>
            {services.map((s) => (
              <option key={s.service} value={s.service}>
                {s.service} ({s.trace_count})
              </option>
            ))}
          </select>
        )}
      </div>

      {services.length === 0 && (
        <p className="hint">
          No APM data yet — create an ingest key in Admin → Monitor admin → APM ingest keys, then send traces to{" "}
          <code>POST /apm/traces</code>. See <code>docs/apm-rum-integration.md</code> for a copy-paste snippet.
        </p>
      )}

      {stats && (
        <>
          <div className="stat-tiles">
            <div className="stat-tile">
              <span className="stat-label">Apdex</span>
              <span className="stat-value">{stats.overall.apdex !== null ? stats.overall.apdex.toFixed(2) : "—"}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">p50</span>
              <span className="stat-value">{fmtMs(stats.overall.p50)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">p95</span>
              <span className="stat-value">{fmtMs(stats.overall.p95)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">p99</span>
              <span className="stat-value">{fmtMs(stats.overall.p99)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">Error rate</span>
              <span className="stat-value">{stats.overall.errorRatePct.toFixed(1)}%</span>
              <span className="hint">{stats.overall.count} traces</span>
            </div>
          </div>

          <h3>Transactions</h3>
          <table className="reports-table">
            <thead>
              <tr>
                <th>Transaction</th>
                <th>Count</th>
                <th>Apdex</th>
                <th>p50</th>
                <th>p95</th>
                <th>p99</th>
                <th>Error rate</th>
              </tr>
            </thead>
            <tbody>
              {stats.transactions.map((t) => (
                <tr key={t.transaction}>
                  <td>{t.transaction}</td>
                  <td>{t.count}</td>
                  <td>{t.apdex !== null ? t.apdex.toFixed(2) : "—"}</td>
                  <td>{fmtMs(t.p50)}</td>
                  <td>{fmtMs(t.p95)}</td>
                  <td>{fmtMs(t.p99)}</td>
                  <td>{t.errorRatePct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Slowest traces</h3>
          <ul className="admin-list">
            {slowest.map((t) => (
              <li key={t.id}>
                <span>
                  <strong>{t.transaction}</strong>{" "}
                  <span className={`badge status-${t.status === "error" ? "critical" : "up"}`}>{t.status}</span>{" "}
                  <span className="hint">{new Date(t.ts).toLocaleString()}</span>
                </span>
                <span>
                  <span className="hint">{t.duration_ms}ms</span>{" "}
                  <button type="button" className="link-button" onClick={() => openTrace(t.id)}>
                    View spans
                  </button>
                </span>
              </li>
            ))}
          </ul>

          {selectedTrace && (
            <>
              <h4>
                Trace: {selectedTrace.trace.transaction} ({selectedTrace.trace.duration_ms}ms)
              </h4>
              <ApmSpanWaterfall spans={selectedTrace.spans} />
            </>
          )}
        </>
      )}
    </div>
  );
}
