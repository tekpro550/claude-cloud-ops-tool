/**
 * Least-squares linear forecast of when a disk fills. Given timestamped disk
 * usage percentages, fits usage = a + b·day and projects the day usage
 * reaches 100%. A flat or falling trend (b <= 0) yields no forecast -- the
 * review's "disk full in ~9 days" feature, done as a plain regression, not
 * an LLM.
 */
export interface DiskSample {
  /** Epoch milliseconds. */
  t: number;
  /** Disk usage percent, 0-100. */
  value: number;
}

export interface DiskForecast {
  daysToFull: number;
  ratePerDay: number;
  currentPct: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function forecastDaysToFull(samples: DiskSample[]): DiskForecast | null {
  if (samples.length < 3) return null;

  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const t0 = sorted[0].t;
  const xs = sorted.map((s) => (s.t - t0) / MS_PER_DAY);
  const ys = sorted.map((s) => s.value);

  // Need a real time span, not three samples in the same minute.
  const spanDays = xs[xs.length - 1] - xs[0];
  if (spanDays <= 0) return null;

  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < n; i += 1) {
    cov += (xs[i] - meanX) * (ys[i] - meanY);
    varX += (xs[i] - meanX) ** 2;
  }
  if (varX === 0) return null;

  const slope = cov / varX; // percent per day
  const intercept = meanY - slope * meanX;
  const lastX = xs[xs.length - 1];
  const currentPct = intercept + slope * lastX;

  // Not filling (flat or draining).
  if (slope <= 0.01) return null;

  const daysToFull = (100 - currentPct) / slope;
  return {
    daysToFull: Math.max(0, Math.round(daysToFull * 10) / 10),
    ratePerDay: Math.round(slope * 100) / 100,
    currentPct: Math.round(currentPct * 10) / 10,
  };
}
