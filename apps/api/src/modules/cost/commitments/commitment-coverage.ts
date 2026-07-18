/**
 * Coverage/utilization math for an owned commitment, per
 * docs/implementation-plan-competitive-parity.md task 4. A Savings-Plan-style
 * `hourly_commitment` ($/hour) is compared day by day against that scope's
 * actual on-demand-equivalent spend from cost_line_items (daily granularity
 * is the finest available -- see the CreateCommitments migration doc
 * comment): each day, up to `dailyCommitmentAmount` of that day's spend
 * counts as "covered" by the commitment; any excess still runs at on-demand
 * rates, and any shortfall (spend below the commitment) is wasted capacity.
 *
 * coveredSpend (= usedCommitment) is the same quantity either way -- coverage
 * asks "what fraction of MY SPEND did the commitment cover", utilization asks
 * "what fraction of MY COMMITMENT did I actually use" -- just normalized
 * against a different denominator.
 */

export interface DailySpendRow {
  usage_date: Date;
  amount: number;
}

/**
 * Zero-fills every day in [startDate, endDate] with no matching row -- a
 * missing day is $0 spend that day, not a gap to skip (skipping would bias
 * both the coverage denominator and a percentile-based recommendation
 * baseline upward). Shared by CommitmentsService (coverage/utilization) and
 * CommitmentSweepService (recommendation input) so both work from daily
 * arrays with the exact same zero-filling rule.
 */
export function buildDailySpend(
  startDate: Date,
  endDate: Date,
  rows: DailySpendRow[],
): number[] {
  const byDay = new Map(
    rows.map((r) => [r.usage_date.toISOString().slice(0, 10), r.amount]),
  );
  const days: number[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    days.push(byDay.get(cursor.toISOString().slice(0, 10)) ?? 0);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export interface CoverageResult {
  totalSpend: number;
  coveredSpend: number;
  coveragePct: number;
}

export function computeCoverage(
  dailySpend: number[],
  dailyCommitmentAmount: number,
): CoverageResult {
  const totalSpend = dailySpend.reduce((sum, v) => sum + v, 0);
  const coveredSpend = dailySpend.reduce(
    (sum, v) => sum + Math.min(v, dailyCommitmentAmount),
    0,
  );
  const coveragePct = totalSpend > 0 ? (coveredSpend / totalSpend) * 100 : 0;
  return { totalSpend, coveredSpend, coveragePct };
}

export interface UtilizationResult {
  committedTotal: number;
  usedTotal: number;
  utilizationPct: number;
  wastedAmount: number;
}

export function computeUtilization(
  dailySpend: number[],
  dailyCommitmentAmount: number,
): UtilizationResult {
  const committedTotal = dailyCommitmentAmount * dailySpend.length;
  const usedTotal = dailySpend.reduce(
    (sum, v) => sum + Math.min(v, dailyCommitmentAmount),
    0,
  );
  const utilizationPct =
    committedTotal > 0 ? (usedTotal / committedTotal) * 100 : 0;
  const wastedAmount = Math.max(0, committedTotal - usedTotal);
  return { committedTotal, usedTotal, utilizationPct, wastedAmount };
}
