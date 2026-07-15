import { QueryRunner } from 'typeorm';
import { RightsizingRecommendationType } from './rightsizing-reason-text';

// A recommendation to fully stop/terminate an idle resource is modeled as
// ~100% of its share of the account's spend; a rightsize (move to a smaller
// instance type) as ~50%, a common single-size-step saving in AWS/Azure's
// own instance-size pricing ladders.
const SAVING_FRACTION: Record<RightsizingRecommendationType, number> = {
  idle: 1,
  rightsize: 0.5,
  terminate: 1,
};

/**
 * Sprint 4 shipped with estimated_monthly_saving always null, documented as
 * "cost_line_items has no per-instance granularity". Sprint 5 needs a real
 * number to log into cost_savings_log.expected_monthly_saving (NOT NULL per
 * the schema), so this fills that gap with an explicit, disclosed heuristic
 * rather than real per-resource billing data: last month's total spend for
 * the resource's cloud account, split evenly across every server resource
 * tracked under that same account, times the recommendation type's expected
 * saving fraction. Not exact -- an idle t3.micro and a busy m5.4xlarge under
 * the same account get the same average -- but directionally useful, and
 * clearly labeled as an estimate everywhere it's surfaced (reason_text,
 * the recommendations list, cost_savings_log). Returns null when there's no
 * cost data or no known account to estimate from, rather than guessing.
 */
export async function estimateMonthlySaving(
  queryRunner: QueryRunner,
  resourceId: string,
  recommendationType: RightsizingRecommendationType,
): Promise<number | null> {
  const [resource] = await queryRunner.query(
    `SELECT cloud_credential_id FROM resources WHERE id = $1`,
    [resourceId],
  );
  const cloudCredentialId = resource?.cloud_credential_id as string | null;
  if (!cloudCredentialId) return null;

  const [spendRow] = await queryRunner.query(
    `SELECT COALESCE(SUM(amount), 0)::float AS total FROM cost_line_items
     WHERE cloud_credential_id = $1
       AND usage_date >= (date_trunc('month', now()) - interval '1 month')::date
       AND usage_date < date_trunc('month', now())::date`,
    [cloudCredentialId],
  );
  const [countRow] = await queryRunner.query(
    `SELECT COUNT(*)::int AS count FROM resources
     WHERE cloud_credential_id = $1 AND resource_type = 'server'`,
    [cloudCredentialId],
  );

  const monthlySpend = spendRow.total as number;
  const resourceCount = countRow.count as number;
  if (monthlySpend <= 0 || resourceCount === 0) return null;

  const perResourceSpend = monthlySpend / resourceCount;
  return perResourceSpend * SAVING_FRACTION[recommendationType];
}
