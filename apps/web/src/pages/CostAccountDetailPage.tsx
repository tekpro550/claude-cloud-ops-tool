import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useParams } from "react-router-dom";
import CostSparkline from "../components/CostSparkline";
import { getAccountLineItems, getAccountSummary } from "../lib/costApiClient";
import type { LineItemFilters } from "../lib/costApiClient";
import { useTenant } from "../lib/tenant";
import type { AccountCostSummary, CostLineItem } from "../types/cost";

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

/** Per-account drill-down (scope doc section 6): the same card shape as the rollup, expanded, plus the raw line-item table with filters. */
export default function CostAccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { tenantId } = useTenant();
  const [summary, setSummary] = useState<AccountCostSummary | null>(null);
  const [lineItems, setLineItems] = useState<CostLineItem[]>([]);
  // filters is the draft bound to the form inputs; appliedFilters is what
  // was last submitted and drives the actual fetch, so typing in the
  // service/region text inputs doesn't hit the network on every keystroke.
  const [filters, setFilters] = useState<LineItemFilters>({});
  const [appliedFilters, setAppliedFilters] = useState<LineItemFilters>({});
  const [loading, setLoading] = useState(false);

  const loadSummary = () => {
    if (!tenantId || !id) return;
    getAccountSummary(tenantId, id).then(setSummary);
  };
  useEffect(loadSummary, [tenantId, id]);

  const loadLineItems = () => {
    if (!tenantId || !id) return;
    setLoading(true);
    getAccountLineItems(tenantId, id, appliedFilters)
      .then(setLineItems)
      .finally(() => setLoading(false));
  };
  useEffect(loadLineItems, [tenantId, id, appliedFilters]);

  const handleFilterSubmit = (event: FormEvent) => {
    event.preventDefault();
    setAppliedFilters(filters);
  };

  if (!tenantId || !id) {
    return <p className="hint">Set a tenant id above to view cost data.</p>;
  }

  if (!summary) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <h2>
        <span className="badge">{summary.provider}</span> {summary.label}
      </h2>

      <div className="stat-tiles">
        <div className="stat-tile">
          <div className="stat-tile-value">{formatMoney(summary.previousMonthTotal)}</div>
          <div className="stat-tile-label">Last month</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-value">
            {formatMoney(summary.mtdSpend)} <PctChangeBadge pct={summary.mtdPctChange} />
          </div>
          <div className="stat-tile-label">Month to date</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile-value">
            {formatMoney(summary.forecast)} <PctChangeBadge pct={summary.forecastPctChange} />
          </div>
          <div className="stat-tile-label">Forecast (full month)</div>
        </div>
      </div>

      {summary.insightText && <p className="hint">{summary.insightText}</p>}

      <h3>Trend</h3>
      <CostSparkline data={summary.trend} />

      <div className="cost-account-breakdowns">
        <div>
          <h3>Top services (MTD)</h3>
          <ul className="cost-breakdown-list">
            {summary.topServices.map((s) => (
              <li key={s.service}>
                {s.service} — {formatMoney(s.total)}
              </li>
            ))}
            {summary.topServices.length === 0 && <li className="hint">No spend yet this month.</li>}
          </ul>
        </div>
        <div>
          <h3>Top regions (MTD)</h3>
          <ul className="cost-breakdown-list">
            {summary.topRegions.map((r) => (
              <li key={r.region}>
                {r.region} — {formatMoney(r.total)}
              </li>
            ))}
            {summary.topRegions.length === 0 && <li className="hint">No spend yet this month.</li>}
          </ul>
        </div>
      </div>

      <h3>Line items</h3>
      <form className="admin-form" onSubmit={handleFilterSubmit}>
        <input
          type="date"
          placeholder="From"
          value={filters.startDate ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value || undefined }))}
        />
        <input
          type="date"
          placeholder="To"
          value={filters.endDate ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value || undefined }))}
        />
        <input
          placeholder="Service"
          value={filters.service ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, service: e.target.value || undefined }))}
        />
        <input
          placeholder="Region"
          value={filters.region ?? ""}
          onChange={(e) => setFilters((f) => ({ ...f, region: e.target.value || undefined }))}
        />
        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? "Loading…" : "Apply filters"}
        </button>
      </form>

      {lineItems.length === 0 && <p className="hint">No line items match those filters.</p>}
      {lineItems.length > 0 && (
        <div className="line-items-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Service</th>
                <th>Region</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.usage_date.slice(0, 10)}</td>
                  <td>{item.service}</td>
                  <td>{item.region ?? "—"}</td>
                  <td>
                    {Number(item.amount).toFixed(2)} {item.currency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
