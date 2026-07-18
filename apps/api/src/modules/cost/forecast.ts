/**
 * Richer cost forecasting than cost-pace.ts's naive linear projection
 * (mtdSpend / daysElapsed * daysInMonth, which assumes every day of the
 * month spends at the same rate). Two independent forecasts:
 *
 *  - forecastMonthEnd: weekday-weighted -- computes a separate average daily
 *    rate per day-of-week from the days elapsed so far, then projects each
 *    remaining calendar day at ITS weekday's rate rather than the flat
 *    average. A weekday-heavy resource (e.g. compute that scales down on
 *    weekends) forecasts noticeably better than a flat rate once there's a
 *    reason to expect weekday variance. Falls back to a flat-rate ("linear")
 *    projection when there's under a week of data -- not enough signal yet
 *    to trust seven separate weekday buckets.
 *  - forecastMultiMonth: ordinary least-squares linear regression over
 *    trailing monthly totals, projected forward -- catches a genuine
 *    month-over-month trend a single month's pace can't see at all.
 *
 * Both report a confidence band from residual variance, disclosed as a
 * simplification (independent-day variance scaling / ±1 residual stddev)
 * rather than a rigorous prediction interval -- same spirit as
 * detectMetricAnomaly's and commitment-recommend.ts's own disclosed
 * approximations.
 */

const MIN_DAYS_FOR_WEEKDAY_WEIGHTING = 7;
const MIN_MONTHS_FOR_TREND = 3;

export interface MonthEndForecastInput {
  /** Spend for day 1..daysElapsed of the month being forecast, in calendar order. */
  elapsedDailySpend: number[];
  /** getUTCDay() (0=Sun..6=Sat) for each entry in elapsedDailySpend, same length/order. */
  elapsedDayOfWeek: number[];
  /** getUTCDay() for each remaining day of the month, in calendar order. */
  remainingDayOfWeek: number[];
}

export interface MonthEndForecastResult {
  mtdSpend: number;
  projectedFullMonth: number;
  low: number;
  high: number;
  method: 'weekday_weighted' | 'linear';
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stddev(values: number[], m: number): number {
  const variance =
    values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function forecastMonthEnd(
  input: MonthEndForecastInput,
): MonthEndForecastResult | null {
  const { elapsedDailySpend, elapsedDayOfWeek, remainingDayOfWeek } = input;
  if (elapsedDailySpend.length === 0) return null;

  const mtdSpend = elapsedDailySpend.reduce((sum, v) => sum + v, 0);
  const overallAvg = mean(elapsedDailySpend);
  const daySpread = stddev(elapsedDailySpend, overallAvg);

  let projectedRemaining: number;
  let method: MonthEndForecastResult['method'];

  if (elapsedDailySpend.length < MIN_DAYS_FOR_WEEKDAY_WEIGHTING) {
    projectedRemaining = overallAvg * remainingDayOfWeek.length;
    method = 'linear';
  } else {
    const byWeekday = new Map<number, number[]>();
    elapsedDailySpend.forEach((amount, i) => {
      const dow = elapsedDayOfWeek[i];
      const bucket = byWeekday.get(dow) ?? [];
      bucket.push(amount);
      byWeekday.set(dow, bucket);
    });
    const weekdayAvg = new Map<number, number>();
    for (const [dow, amounts] of byWeekday) {
      weekdayAvg.set(dow, mean(amounts));
    }
    projectedRemaining = remainingDayOfWeek.reduce(
      (sum, dow) => sum + (weekdayAvg.get(dow) ?? overallAvg),
      0,
    );
    method = 'weekday_weighted';
  }

  const projectedFullMonth = mtdSpend + projectedRemaining;
  // Variance of a sum of `n` roughly-independent daily projections scales
  // with sqrt(n) -- a standard, simplified band width, not a rigorous
  // prediction interval.
  const bandWidth = daySpread * Math.sqrt(remainingDayOfWeek.length);
  return {
    mtdSpend,
    projectedFullMonth,
    low: Math.max(mtdSpend, projectedFullMonth - bandWidth),
    high: projectedFullMonth + bandWidth,
    method,
  };
}

export interface MultiMonthForecastPoint {
  monthsAhead: number;
  projected: number;
  low: number;
  high: number;
}

export interface MultiMonthForecastResult {
  points: MultiMonthForecastPoint[];
  slopePerMonth: number;
  residualStddev: number;
}

/**
 * Returns null with fewer than MIN_MONTHS_FOR_TREND data points -- not
 * enough to distinguish a real trend from noise.
 */
export function forecastMultiMonth(
  monthlyTotals: number[],
  horizonMonths: number,
): MultiMonthForecastResult | null {
  const n = monthlyTotals.length;
  if (n < MIN_MONTHS_FOR_TREND || horizonMonths < 1) return null;

  const xs = monthlyTotals.map((_, i) => i);
  const xMean = mean(xs);
  const yMean = mean(monthlyTotals);
  const numerator = xs.reduce(
    (sum, x, i) => sum + (x - xMean) * (monthlyTotals[i] - yMean),
    0,
  );
  const denominator = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  const slopePerMonth = denominator > 0 ? numerator / denominator : 0;
  const intercept = yMean - slopePerMonth * xMean;

  const residuals = monthlyTotals.map(
    (y, i) => y - (intercept + slopePerMonth * xs[i]),
  );
  const residualStddev = stddev(residuals, 0);

  const points: MultiMonthForecastPoint[] = [];
  for (let h = 1; h <= horizonMonths; h++) {
    const x = n - 1 + h;
    const projected = Math.max(0, intercept + slopePerMonth * x);
    points.push({
      monthsAhead: h,
      projected,
      low: Math.max(0, projected - residualStddev),
      high: projected + residualStddev,
    });
  }

  return { points, slopePerMonth, residualStddev };
}
