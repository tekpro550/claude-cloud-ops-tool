import { useEffect, useState } from "react";
import { getRumPageStats, listRumPages } from "../lib/monitoringApiClient";
import type { RumPageStats, RumPageSummary } from "../types/monitoring";
import { useTenant } from "../lib/tenant";

const METRIC_LABELS: Record<string, string> = {
  lcp: "Largest Contentful Paint",
  fcp: "First Contentful Paint",
  ttfb: "Time to First Byte",
};

/** Site24x7 RUM-style dashboard: page list -> LCP/FCP/TTFB percentiles + JS error rate per page. */
export default function RumDashboardPage() {
  const { tenantId } = useTenant();
  const [pages, setPages] = useState<RumPageSummary[]>([]);
  const [page, setPage] = useState("");
  const [stats, setStats] = useState<RumPageStats | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    listRumPages(tenantId).then((p) => {
      setPages(p);
      if (!page && p.length > 0) setPage(p[0].page);
    });
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId || !page) return;
    getRumPageStats(tenantId, page).then(setStats);
  }, [tenantId, page]);

  if (!tenantId) return <p className="hint">Set a tenant id above to view RUM.</p>;

  return (
    <div>
      <div className="reports-header">
        <h2>Real user monitoring</h2>
        {pages.length > 0 && (
          <select value={page} onChange={(e) => setPage(e.target.value)}>
            {pages.map((p) => (
              <option key={p.page} value={p.page}>
                {p.page} ({p.event_count})
              </option>
            ))}
          </select>
        )}
      </div>

      {pages.length === 0 && (
        <p className="hint">
          No RUM data yet — create an app key in Admin → Monitor admin → RUM app keys, then add the beacon snippet to
          your site. See <code>docs/apm-rum-integration.md</code>.
        </p>
      )}

      {stats && (
        <>
          <div className="stat-tiles">
            {stats.timings.map((t) => (
              <div className="stat-tile" key={t.metric}>
                <span className="stat-label">{METRIC_LABELS[t.metric]}</span>
                <span className="stat-value">p95 {t.count > 0 ? `${Math.round(t.p95)}ms` : "—"}</span>
                <span className="hint">p50 {Math.round(t.p50)}ms · {t.count} samples</span>
              </div>
            ))}
            <div className="stat-tile">
              <span className="stat-label">JS error rate</span>
              <span className="stat-value">{stats.errorRatePct.toFixed(1)}%</span>
              <span className="hint">{stats.errorCount} errors</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
