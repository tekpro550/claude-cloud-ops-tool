import { useEffect, useState } from "react";
import TrendsChart from "../components/TrendsChart";
import {
  dismissDiskForecast,
  getMonitoringDashboardSummary,
  getMonitoringDashboardTrends,
  listDiskForecasts,
  type DiskForecast,
} from "../lib/monitoringApiClient";
import { useTenant } from "../lib/tenant";
import type { MonitoringDashboardSummary } from "../types/monitoring";
import type { DashboardTrendPoint } from "../types/ticket";

/**
 * Tenant-wide Monitoring dashboard: stat tiles + a trend chart, the same
 * shape as Module 1's ticketing DashboardPage. Fleet status (the resource
 * list) stays the separate landing view -- this is the glanceable summary
 * on top of it.
 */
export default function MonitoringDashboardPage() {
  const { tenantId } = useTenant();
  const [summary, setSummary] = useState<MonitoringDashboardSummary | null>(null);
  const [trends, setTrends] = useState<DashboardTrendPoint[]>([]);
  const [diskForecasts, setDiskForecasts] = useState<DiskForecast[]>([]);
  const [loading, setLoading] = useState(false);

  const loadForecasts = () => {
    if (!tenantId) return;
    listDiskForecasts(tenantId).then(setDiskForecasts).catch(() => {});
  };

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    Promise.all([getMonitoringDashboardSummary(tenantId), getMonitoringDashboardTrends(tenantId, 14)])
      .then(([summaryRes, trendsRes]) => {
        setSummary(summaryRes);
        setTrends(trendsRes);
      })
      .finally(() => setLoading(false));
    loadForecasts();
  }, [tenantId]);

  const handleDismissForecast = (id: string) => {
    if (!tenantId) return;
    dismissDiskForecast(tenantId, id).then(loadForecasts).catch(() => {});
  };

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to load the monitoring dashboard.</p>;
  }

  if (loading && !summary) {
    return <p>Loading…</p>;
  }

  if (!summary) return null;

  return (
    <div>
      <h2>Monitoring dashboard</h2>

      <h3>Resources</h3>
      <div className="stat-tiles">
        <StatTile label="Total" value={summary.resources.total} />
        <StatTile label="Up" value={summary.resources.up} />
        <StatTile label="Down" value={summary.resources.down} tone={summary.resources.down > 0 ? "critical" : undefined} />
        <StatTile
          label="Critical"
          value={summary.resources.critical}
          tone={summary.resources.critical > 0 ? "critical" : undefined}
        />
        <StatTile label="Trouble" value={summary.resources.trouble} />
        <StatTile label="No monitor" value={summary.resources.none} />
      </div>

      <h3>Monitors</h3>
      <div className="stat-tiles">
        <StatTile label="Total" value={summary.monitors.total} />
        <StatTile label="Enabled" value={summary.monitors.enabled} />
      </div>

      {diskForecasts.length > 0 && (
        <>
          <h3>Disk-full forecasts</h3>
          <ul className="anomaly-list">
            {diskForecasts.map((f) => (
              <li key={f.id} className="anomaly-item">
                <span className="badge status-breached">~{Number(f.days_to_full)}d</span>
                <span className="anomaly-reason">{f.reason_text}</span>
                <button type="button" className="btn-ghost btn-sm" onClick={() => handleDismissForecast(f.id)}>
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Open alerts</h3>
      <div className="stat-tiles">
        <StatTile label="Total" value={summary.openAlerts.total} tone={summary.openAlerts.total > 0 ? "critical" : undefined} />
        <StatTile
          label="Critical"
          value={summary.openAlerts.critical}
          tone={summary.openAlerts.critical > 0 ? "critical" : undefined}
        />
        <StatTile label="Warning" value={summary.openAlerts.warning} />
        <StatTile label="Info" value={summary.openAlerts.info} />
      </div>

      <h3>Alerts trend (last 14 days)</h3>
      <TrendsChart
        data={trends}
        createdLabel="Opened"
        resolvedLabel="Resolved"
        ariaLabel="Alerts opened and resolved per day, last 14 days"
      />
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: "critical" }) {
  return (
    <div className={`stat-tile${tone ? ` stat-tile-${tone}` : ""}`}>
      <div className="stat-tile-value">{value}</div>
      <div className="stat-tile-label">{label}</div>
    </div>
  );
}
