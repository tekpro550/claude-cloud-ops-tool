import type { CostForecastResult } from "../types/cost";

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

const METHOD_LABEL: Record<string, string> = {
  weekday_weighted: "weekday-weighted",
  linear: "flat-rate (early in the month)",
};

/**
 * Richer forecast than the summary tile's naive linear pace: a weekday-
 * weighted month-end projection with a confidence band, plus a multi-month
 * trend projection. See apps/api's forecast.ts for the math.
 */
export default function ForecastPanel({ forecast }: { forecast: CostForecastResult }) {
  const { monthEnd, multiMonth } = forecast;

  if (!monthEnd && !multiMonth) {
    return <p className="hint">Not enough cost history yet to forecast.</p>;
  }

  return (
    <div className="forecast-panel">
      {monthEnd && (
        <div className="forecast-month-end">
          <div className="forecast-band">
            <span className="forecast-band-value">{money(monthEnd.projectedFullMonth)}</span>
            <span className="hint">
              {" "}
              range {money(monthEnd.low)}–{money(monthEnd.high)} · {METHOD_LABEL[monthEnd.method]}
            </span>
          </div>
          <p className="hint">Month-to-date: {money(monthEnd.mtdSpend)}, projected to full month above.</p>
        </div>
      )}

      {multiMonth && multiMonth.points.length > 0 && (
        <div className="forecast-multi-month">
          <p className="hint">
            Trend: {multiMonth.slopePerMonth >= 0 ? "+" : ""}
            {money(multiMonth.slopePerMonth)}/month
          </p>
          <table className="forecast-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Projected</th>
                <th>Range</th>
              </tr>
            </thead>
            <tbody>
              {multiMonth.points.map((p) => (
                <tr key={p.monthsAhead}>
                  <td>+{p.monthsAhead}mo</td>
                  <td>{money(p.projected)}</td>
                  <td className="hint">
                    {money(p.low)}–{money(p.high)}
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
