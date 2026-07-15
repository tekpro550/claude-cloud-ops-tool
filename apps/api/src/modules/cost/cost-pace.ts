/**
 * MTD pace calculation, per docs/Cloud-Ops-Tool-Module3-Cost-FinOps-Scope.md
 * section 5: pace_adjusted_expected = (mtd_spend / days_elapsed) *
 * days_in_month, compared against a baseline -- the budget's own
 * monthly_budget_amount if one is set, or last month's actual total when
 * it isn't ("pace-only alerting, no hard cap", section 3). Tiering is a
 * direct port of the architecture plan's own numbers: 10-20% over pace is
 * info, 20-40% is warning, over 40% (or an outright hard-cap breach,
 * regardless of pace%) is critical.
 */

const INFO_THRESHOLD_PCT = 10;

export type BudgetPaceSeverity = 'info' | 'warning' | 'critical';

export interface BudgetPaceInput {
  mtdSpend: number;
  previousMonthTotal: number | null;
  monthlyBudgetAmount: number | null;
  daysElapsed: number;
  daysInMonth: number;
  warningThresholdPct: number;
  criticalThresholdPct: number;
}

export interface BudgetPaceResult {
  projectedFullMonth: number;
  baseline: number;
  /** Which source the baseline came from -- changes the wording in generateCostInsightText. */
  baselineSource: 'budget' | 'last_month';
  pctOverPace: number;
  severity: BudgetPaceSeverity | null;
  hardCapBreached: boolean;
}

export function calculateBudgetPace(
  input: BudgetPaceInput,
): BudgetPaceResult | null {
  if (input.daysElapsed <= 0) return null;

  // No baseline to compare against yet -- no budget set and no prior
  // month's data (e.g. this account was only just connected). Nothing to
  // alert on until there's something to be "over pace" relative to.
  const baseline = input.monthlyBudgetAmount ?? input.previousMonthTotal;
  if (baseline === null || baseline <= 0) return null;

  const projectedFullMonth =
    (input.mtdSpend / input.daysElapsed) * input.daysInMonth;
  const pctOverPace = ((projectedFullMonth - baseline) / baseline) * 100;
  const hardCapBreached =
    input.monthlyBudgetAmount != null &&
    input.mtdSpend > input.monthlyBudgetAmount;

  let severity: BudgetPaceSeverity | null = null;
  if (hardCapBreached || pctOverPace >= input.criticalThresholdPct) {
    severity = 'critical';
  } else if (pctOverPace >= input.warningThresholdPct) {
    severity = 'warning';
  } else if (pctOverPace >= INFO_THRESHOLD_PCT) {
    severity = 'info';
  }

  return {
    projectedFullMonth,
    baseline,
    baselineSource: input.monthlyBudgetAmount != null ? 'budget' : 'last_month',
    pctOverPace,
    severity,
    hardCapBreached,
  };
}

/**
 * One generation path, read in three places (dashboard card, notification
 * body, and a recommendation's first ticket note) -- section 5's "insight
 * sentences" principle, the same one Module 2 used for alert reason_text.
 */
export function generateCostInsightText(
  budgetName: string,
  result: BudgetPaceResult,
): string {
  if (result.hardCapBreached) {
    return `${budgetName} has already exceeded its monthly budget of ${result.baseline.toFixed(2)} this month (spent so far puts it over, before the month is even out).`;
  }
  const direction = result.pctOverPace >= 0 ? 'rise' : 'drop';
  const pct = Math.abs(Math.round(result.pctOverPace));
  const baselineLabel =
    result.baselineSource === 'budget' ? 'its budget' : 'last month';
  return `${budgetName}'s month-to-date spend is on pace to ${direction} ${pct}% versus ${baselineLabel}, projected at ${result.projectedFullMonth.toFixed(2)} for the full month.`;
}
