export type RightsizingRecommendationType = 'rightsize' | 'idle' | 'terminate';

/**
 * One generation path, read in the recommendations list and the
 * create-ticket description (same principle as Module 2's
 * generateReasonText / this module's generateCostInsightText).
 */
export function generateRightsizingReasonText(
  resourceName: string,
  type: RightsizingRecommendationType,
  avgUtilizationPct: number,
): string {
  const pct = avgUtilizationPct.toFixed(1);
  if (type === 'idle') {
    return `${resourceName}'s CPU utilization has averaged ${pct}% over the last 14 days; consider stopping or terminating it.`;
  }
  return `${resourceName}'s CPU utilization has averaged ${pct}% over the last 14 days; consider downsizing to a smaller instance type.`;
}
