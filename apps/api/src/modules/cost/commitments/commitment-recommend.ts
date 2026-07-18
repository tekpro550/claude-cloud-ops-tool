/**
 * Recommend a commitment level from a scope's trailing on-demand daily
 * spend. Disclosed simplifications (same spirit as cost-savings-estimate.ts):
 *  - Discount rates are published industry rule-of-thumb figures for a
 *    1-year term, not this tenant's actual negotiated/list pricing (which
 *    cost_line_items has no way to know) -- Reserved Instances ~35% off
 *    on-demand, Savings Plans ~27% (RIs trade flexibility for a bit more
 *    discount).
 *  - The recommended level covers the LOW end of trailing usage (a
 *    percentile, not the average or max), so the commitment tracks the
 *    stable floor of spend rather than over-committing against spikes that
 *    may not recur -- the same "don't guess above what's actually stable"
 *    posture RightsizingSweepService takes with utilization thresholds.
 *  - break-even assumes a partial-upfront term (half the year's discounted
 *    cost paid upfront, the rest billed monthly), a middle-ground payment
 *    option -- an all-upfront commitment breaks even later, no-upfront
 *    breaks even immediately (there's nothing to recoup).
 */

export type CommitmentKind = 'reserved_instance' | 'savings_plan';

const DISCOUNT_PCT: Record<CommitmentKind, number> = {
  reserved_instance: 0.35,
  savings_plan: 0.27,
};

// The percentile of trailing daily spend used as the recommended commitment
// level -- low enough to stay covered on a quiet day, high enough to be a
// meaningful commitment rather than trivially small.
const BASELINE_PERCENTILE = 0.2;
const MIN_DAYS = 14;
const UPFRONT_SHARE = 0.5;

export interface CommitmentRecommendation {
  kind: CommitmentKind;
  recommendedDailyCommitment: number;
  recommendedHourlyCommitment: number;
  estimatedMonthlySavings: number;
  breakEvenMonths: number;
  basedOnDays: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const index = p * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Returns null when there's too little history (< MIN_DAYS) or the scope's
 * usage floor is effectively zero -- nothing stable enough to recommend
 * committing against, rather than guessing.
 */
export function recommendCommitment(
  dailySpend: number[],
  kind: CommitmentKind,
): CommitmentRecommendation | null {
  if (dailySpend.length < MIN_DAYS) return null;

  const sorted = [...dailySpend].sort((a, b) => a - b);
  const recommendedDailyCommitment = percentile(sorted, BASELINE_PERCENTILE);
  if (recommendedDailyCommitment <= 0) return null;

  const discountPct = DISCOUNT_PCT[kind];
  const estimatedMonthlySavings = recommendedDailyCommitment * 30 * discountPct;

  const annualDiscountedCost =
    recommendedDailyCommitment * 365 * (1 - discountPct);
  const upfrontCost = annualDiscountedCost * UPFRONT_SHARE;
  const breakEvenMonths = upfrontCost / estimatedMonthlySavings;

  return {
    kind,
    recommendedDailyCommitment,
    recommendedHourlyCommitment: recommendedDailyCommitment / 24,
    estimatedMonthlySavings,
    breakEvenMonths,
    basedOnDays: dailySpend.length,
  };
}
