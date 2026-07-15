import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { calculateBudgetPace } from './cost-pace';

/**
 * Tenant-wide stat tiles + trend for Cost, the same shape Module 2's new
 * monitoring dashboard and Module 1's ticketing dashboard both use --
 * the MSP rollup (/cost) stays the per-account entity view, this is the
 * separate glanceable tenant-wide summary, per the user's ask for Module
 * 2/3 to each have "their own dashboard".
 *
 * Forecast reuses calculateBudgetPace() from cost-pace.ts against the
 * tenant-wide aggregate MTD/previous-month totals -- the same pure
 * function CostAccountsService already applies per-account, not a second
 * implementation of the same math.
 */
@Injectable()
export class CostDashboardService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  summary(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const now = new Date();
      const daysElapsed = now.getUTCDate();
      const daysInMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
      ).getUTCDate();

      const [mtdRow] = await queryRunner.query(
        `SELECT COALESCE(SUM(amount), 0)::float AS total FROM cost_line_items
         WHERE usage_date >= date_trunc('month', now())::date`,
      );
      const [prevRow] = await queryRunner.query(
        `SELECT COALESCE(SUM(amount), 0)::float AS total FROM cost_line_items
         WHERE usage_date >= (date_trunc('month', now()) - interval '1 month')::date
           AND usage_date < date_trunc('month', now())::date`,
      );
      const [accountsRow] = await queryRunner.query(
        `SELECT count(*)::int AS total FROM cloud_credentials WHERE is_enabled = true`,
      );
      const [alertRow] = await queryRunner.query(
        `SELECT count(*)::int AS total FROM alerts
         WHERE status IN ('open', 'acknowledged') AND cost_budget_id IS NOT NULL`,
      );
      const [recRow] = await queryRunner.query(
        `SELECT count(*)::int AS total FROM rightsizing_recommendations WHERE status = 'open'`,
      );

      const mtdSpend = mtdRow.total as number;
      const previousMonthTotal =
        (prevRow.total as number) > 0 ? (prevRow.total as number) : null;

      const pace = calculateBudgetPace({
        mtdSpend,
        previousMonthTotal,
        monthlyBudgetAmount: null,
        daysElapsed,
        daysInMonth,
        warningThresholdPct: 20,
        criticalThresholdPct: 40,
      });

      return {
        mtdSpend,
        previousMonthTotal,
        forecast: pace ? pace.projectedFullMonth : null,
        forecastPctChange: pace ? pace.pctOverPace : null,
        connectedAccounts: accountsRow.total,
        openBudgetAlerts: alertRow.total,
        openRecommendations: recRow.total,
      };
    });
  }

  /** Aggregate monthly spend across every connected account, trailing 7 months. */
  trend(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`
        SELECT to_char(date_trunc('month', usage_date), 'YYYY-MM') AS month, SUM(amount)::float AS total
        FROM cost_line_items
        WHERE usage_date >= date_trunc('month', now()) - interval '6 months'
        GROUP BY 1 ORDER BY 1
      `),
    );
  }
}
