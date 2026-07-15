import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import BudgetPaceGauge from "../components/BudgetPaceGauge";
import CostSparkline from "../components/CostSparkline";
import { getAccountsSummary } from "../lib/costApiClient";
import { useTenant } from "../lib/tenant";
import type { AccountCostSummary } from "../types/cost";

function formatMoney(value: number | null): string {
  if (value === null) return "—";
  return `$${value.toFixed(2)}`;
}

function PctChangeBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="hint">no baseline yet</span>;
  const tone = pct >= 40 ? "cost-pct-critical" : pct >= 20 ? "cost-pct-warning" : undefined;
  const sign = pct >= 0 ? "+" : "";
  return <span className={tone}>{`${sign}${pct.toFixed(0)}%`}</span>;
}

/**
 * MSP multi-account rollup, the default landing page for the Cost section
 * (scope doc section 6) -- "fleet view first", same principle
 * MonitoringFleetPage and DashboardPage already use as their own landing
 * pages.
 */
export default function CostRollupPage() {
  const { tenantId } = useTenant();
  const [accounts, setAccounts] = useState<AccountCostSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    getAccountsSummary(tenantId)
      .then(setAccounts)
      .finally(() => setLoading(false));
  }, [tenantId]);

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to view cost data.</p>;
  }

  if (loading && accounts.length === 0) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <h2>Cost</h2>
      {accounts.length === 0 && (
        <p className="hint">
          No connected billing accounts yet — add a cloud credential under Admin → Monitoring to start tracking
          cost.
        </p>
      )}
      <div className="cost-account-grid">
        {accounts.map((account) => (
          <div key={account.cloudCredentialId} className="cost-account-card">
            <div className="cost-account-card-header">
              <span>
                <span className="badge">{account.provider}</span>{" "}
                <Link to={`/cost/accounts/${account.cloudCredentialId}`}>{account.label}</Link>
              </span>
            </div>

            <div className="cost-account-stats">
              <div>
                <div className="hint">Last month</div>
                <div className="cost-account-stat-value">{formatMoney(account.previousMonthTotal)}</div>
              </div>
              <div>
                <div className="hint">MTD</div>
                <div className="cost-account-stat-value">
                  {formatMoney(account.mtdSpend)} <PctChangeBadge pct={account.mtdPctChange} />
                </div>
              </div>
              <div>
                <div className="hint">Forecast</div>
                <div className="cost-account-stat-value">
                  {formatMoney(account.forecast)} <PctChangeBadge pct={account.forecastPctChange} />
                </div>
              </div>
            </div>

            {account.insightText && <p className="hint">{account.insightText}</p>}

            <BudgetPaceGauge
              mtdSpend={account.mtdSpend}
              previousMonthTotal={account.previousMonthTotal}
              forecastPctChange={account.forecastPctChange}
            />

            <CostSparkline data={account.trend} />

            <div className="cost-account-breakdowns">
              <div>
                <div className="hint">Top services (MTD)</div>
                <ul className="cost-breakdown-list">
                  {account.topServices.map((s) => (
                    <li key={s.service}>
                      {s.service} — {formatMoney(s.total)}
                    </li>
                  ))}
                  {account.topServices.length === 0 && <li className="hint">No spend yet this month.</li>}
                </ul>
              </div>
              <div>
                <div className="hint">Top regions (MTD)</div>
                <ul className="cost-breakdown-list">
                  {account.topRegions.map((r) => (
                    <li key={r.region}>
                      {r.region} — {formatMoney(r.total)}
                    </li>
                  ))}
                  {account.topRegions.length === 0 && <li className="hint">No spend yet this month.</li>}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
