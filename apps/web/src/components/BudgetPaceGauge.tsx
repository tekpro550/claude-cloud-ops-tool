/**
 * CloudSpend-style pace gauge: a horizontal bar showing MTD spend as a
 * fraction of last month's total, with a marker for how far through the
 * month we are. When the filled bar has passed the marker, spend is
 * outpacing time -- the core FinOps signal a stat-tile percentage alone
 * doesn't make visually obvious.
 */
export default function BudgetPaceGauge({
  mtdSpend,
  previousMonthTotal,
  forecastPctChange,
}: {
  mtdSpend: number;
  previousMonthTotal: number | null;
  forecastPctChange: number | null;
}) {
  if (previousMonthTotal === null || previousMonthTotal <= 0) {
    return <p className="hint">No baseline yet to show pace against.</p>;
  }

  const now = new Date();
  const daysElapsed = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const timePct = Math.min(100, (daysElapsed / daysInMonth) * 100);
  const spendPct = Math.min(100, (mtdSpend / previousMonthTotal) * 100);
  const tone = forecastPctChange === null ? "success" : forecastPctChange >= 40 ? "critical" : forecastPctChange >= 20 ? "warning" : "success";

  return (
    <div className="pace-gauge">
      <div className="pace-gauge-track">
        <div className={`pace-gauge-fill pace-gauge-fill-${tone}`} style={{ width: `${spendPct}%` }} />
        <div className="pace-gauge-time-marker" style={{ left: `${timePct}%` }} title={`Day ${daysElapsed} of ${daysInMonth}`} />
      </div>
      <div className="pace-gauge-legend">
        <span>{spendPct.toFixed(0)}% of last month's spend</span>
        <span className="hint">
          Day {daysElapsed}/{daysInMonth}
        </span>
      </div>
    </div>
  );
}
