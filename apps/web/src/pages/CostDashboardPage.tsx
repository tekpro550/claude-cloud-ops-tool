import { useEffect, useState } from "react";
import CostSparkline from "../components/CostSparkline";
import { getCostDashboardSummary, getCostDashboardTrend } from "../lib/costApiClient";
import { useTenant } from "../lib/tenant";
import type { CostDashboardSummary, CostTrendPoint } from "../types/cost";

function formatMoney(value: number | null): string {
  if (value === null) return "—";
  return `$${Number(value).toFixed(2)}`;
}

/**
 * Tenant-wide Cost dashboard: stat tiles + a trend chart, the same shape
 * Module 1's ticketing DashboardPage and Module 2's new monitoring
 * dashboard both use. The MSP rollup (/cost) stays the per-account entity
 * view -- this is the glanceable tenant-wide summary on top of it.
 */
export default function CostDashboardPage() {
  const { tenantId } = useTenant();
  const [summary, setSummary] = useState<CostDashboardSummary | null>(null);
  const [trend, setTrend] = useState<CostTrendPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    Promise.all([getCostDashboardSummary(tenantId), getCostDashboardTrend(tenantId)])
      .then(([summaryRes, trendRes]) => {
        setSummary(summaryRes);
        setTrend(trendRes);
      })
      .finally(() => setLoading(false));
  }, [tenantId]);

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to load the cost dashboard.</p>;
  }

  if (loading && !summary) {
    return <p>Loading…</p>;
  }

  if (!summary) return null;

  const forecastTone =
    summary.forecastPctChange !== null && summary.forecastPctChange >= 40 ? "critical" : undefined;

  return (
    <div>
      <h2>Cost dashboard</h2>

      <div className="stat-tiles">
        <div className="stat-tile">
          <div className="stat-tile-value">{formatMoney(summary.previousMonthTotal)}</div>
          <div className="stat-tile-label">Last month (all accounts)</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-value">{formatMoney(summary.mtdSpend)}</div>
          <div className="stat-tile-label">Month to date</div>
        </div>
        <div className={`stat-tile${forecastTone ? ` stat-tile-${forecastTone}` : ""}`}>
          <div className="stat-tile-value">
            {formatMoney(summary.forecast)}
            {summary.forecastPctChange !== null && (
              <span className={forecastTone === "critical" ? "cost-pct-critical" : undefined}>
                {" "}
                ({summary.forecastPctChange >= 0 ? "+" : ""}
                {summary.forecastPctChange.toFixed(0)}%)
              </span>
            )}
          </div>
          <div className="stat-tile-label">Forecast (full month)</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-value">{summary.connectedAccounts}</div>
          <div className="stat-tile-label">Connected accounts</div>
        </div>
        <div
          className={`stat-tile${summary.openBudgetAlerts > 0 ? " stat-tile-critical" : ""}`}
        >
          <div className="stat-tile-value">{summary.openBudgetAlerts}</div>
          <div className="stat-tile-label">Open budget alerts</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-value">{summary.openRecommendations}</div>
          <div className="stat-tile-label">Open recommendations</div>
        </div>
      </div>

      <h3>Spend trend (all accounts)</h3>
      <CostSparkline data={trend} />
    </div>
  );
}
