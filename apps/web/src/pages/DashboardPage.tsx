import { useEffect, useState } from "react";
import TrendsChart from "../components/TrendsChart";
import { getDashboardSlaSummary, getDashboardSummary, getDashboardTrends } from "../lib/apiClient";
import { useTenant } from "../lib/tenant";
import type { DashboardSlaSummary, DashboardSummary, DashboardTrendPoint } from "../types/ticket";

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  open: "Open",
  pending: "Pending",
  resolved: "Resolved",
  closed: "Closed",
};

export default function DashboardPage() {
  const { tenantId } = useTenant();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [trends, setTrends] = useState<DashboardTrendPoint[]>([]);
  const [slaSummary, setSlaSummary] = useState<DashboardSlaSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    Promise.all([getDashboardSummary(tenantId), getDashboardTrends(tenantId, 14), getDashboardSlaSummary(tenantId)])
      .then(([summaryRes, trendsRes, slaRes]) => {
        setSummary(summaryRes);
        setTrends(trendsRes);
        setSlaSummary(slaRes);
      })
      .finally(() => setLoading(false));
  }, [tenantId]);

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to load the dashboard.</p>;
  }

  if (loading && !summary) {
    return <p>Loading…</p>;
  }

  if (!summary || !slaSummary) {
    return null;
  }

  return (
    <div>
      <h2>Dashboard</h2>

      <div className="stat-tiles">
        <StatTile label="Open tickets" value={summary.totalOpen} />
        <StatTile
          label="First response overdue"
          value={summary.overdueFirstResponse}
          tone={summary.overdueFirstResponse > 0 ? "critical" : undefined}
        />
        <StatTile
          label="Resolution overdue"
          value={summary.overdueResolution}
          tone={summary.overdueResolution > 0 ? "critical" : undefined}
        />
        {Object.entries(summary.byStatus).map(([status, count]) => (
          <StatTile key={status} label={STATUS_LABELS[status] ?? status} value={count} />
        ))}
      </div>

      <h3>Trends (last 14 days)</h3>
      <TrendsChart data={trends} />

      <h3>SLA summary</h3>
      <div className="stat-tiles">
        <StatTile label="Tickets with an SLA policy" value={slaSummary.totalWithSla} />
        <StatTile label="First response met" value={slaSummary.firstResponse.met} />
        <StatTile
          label="First response breached"
          value={slaSummary.firstResponse.breached}
          tone={slaSummary.firstResponse.breached > 0 ? "critical" : undefined}
        />
        <StatTile label="Resolution met" value={slaSummary.resolution.met} />
        <StatTile
          label="Resolution breached"
          value={slaSummary.resolution.breached}
          tone={slaSummary.resolution.breached > 0 ? "critical" : undefined}
        />
      </div>
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
