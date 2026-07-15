import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { calculateBudgetPace, generateCostInsightText } from './cost-pace';
import { ListLineItemsQueryDto } from './cost-accounts.dto';

interface CloudCredentialRow {
  id: string;
  provider: 'aws' | 'azure';
  label: string;
  last_polled_at: string | null;
}

/**
 * MSP rollup dashboard (scope doc section 6/7 Sprint 3) -- one card per
 * connected account. Forecast and its insight sentence reuse
 * calculateBudgetPace()/generateCostInsightText() from cost-pace.ts with no
 * monthly_budget_amount, so "forecast vs last month" here is the exact same
 * calculation a pace-only cost_budget uses, not a second implementation of
 * the same math.
 */
@Injectable()
export class CostAccountsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  accountsSummary(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const credentials: CloudCredentialRow[] = await queryRunner.query(
        `SELECT id, provider, label, last_polled_at FROM cloud_credentials WHERE is_enabled = true ORDER BY label`,
      );
      const summaries = [];
      for (const credential of credentials) {
        summaries.push(await this.buildSummary(queryRunner, credential));
      }
      return summaries;
    });
  }

  accountSummary(tenantId: string, credentialId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [credential] = await queryRunner.query(
        `SELECT id, provider, label, last_polled_at FROM cloud_credentials WHERE id = $1`,
        [credentialId],
      );
      if (!credential) {
        throw new NotFoundException(
          `Cloud credential ${credentialId} not found`,
        );
      }
      return this.buildSummary(queryRunner, credential);
    });
  }

  lineItems(
    tenantId: string,
    credentialId: string,
    filters: ListLineItemsQueryDto,
  ) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [credential] = await queryRunner.query(
        `SELECT id FROM cloud_credentials WHERE id = $1`,
        [credentialId],
      );
      if (!credential) {
        throw new NotFoundException(
          `Cloud credential ${credentialId} not found`,
        );
      }

      const conditions = ['cloud_credential_id = $1'];
      const params: unknown[] = [credentialId];
      if (filters.startDate) {
        params.push(filters.startDate);
        conditions.push(`usage_date >= $${params.length}`);
      }
      if (filters.endDate) {
        params.push(filters.endDate);
        conditions.push(`usage_date <= $${params.length}`);
      }
      if (filters.service) {
        params.push(filters.service);
        conditions.push(`service = $${params.length}`);
      }
      if (filters.region) {
        params.push(filters.region);
        conditions.push(`region = $${params.length}`);
      }

      return queryRunner.query(
        `SELECT id, service, region, usage_date, amount, currency FROM cost_line_items
         WHERE ${conditions.join(' AND ')}
         ORDER BY usage_date DESC, amount DESC
         LIMIT 500`,
        params,
      );
    });
  }

  private async buildSummary(
    queryRunner: QueryRunner,
    credential: CloudCredentialRow,
  ) {
    const now = new Date();
    const daysElapsed = now.getUTCDate();
    const daysInMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    ).getUTCDate();

    const [mtdRow] = await queryRunner.query(
      `SELECT COALESCE(SUM(amount), 0)::float AS total FROM cost_line_items
       WHERE cloud_credential_id = $1 AND usage_date >= date_trunc('month', now())::date`,
      [credential.id],
    );
    const [prevRow] = await queryRunner.query(
      `SELECT COALESCE(SUM(amount), 0)::float AS total FROM cost_line_items
       WHERE cloud_credential_id = $1
         AND usage_date >= (date_trunc('month', now()) - interval '1 month')::date
         AND usage_date < date_trunc('month', now())::date`,
      [credential.id],
    );
    // Same-day-count slice of last month, so "MTD % change" compares like
    // with like (day 10 of this month against day 1-10 of last month), not
    // MTD against a full prior month.
    const [prevSamePeriodRow] = await queryRunner.query(
      `SELECT COALESCE(SUM(amount), 0)::float AS total FROM cost_line_items
       WHERE cloud_credential_id = $1
         AND usage_date >= (date_trunc('month', now()) - interval '1 month')::date
         AND usage_date < ((date_trunc('month', now()) - interval '1 month')::date + ($2 * interval '1 day'))`,
      [credential.id, daysElapsed],
    );

    const trendRows = await queryRunner.query(
      `SELECT to_char(date_trunc('month', usage_date), 'YYYY-MM') AS month, SUM(amount)::float AS total
       FROM cost_line_items WHERE cloud_credential_id = $1
       GROUP BY 1 ORDER BY 1`,
      [credential.id],
    );
    const topServices = await queryRunner.query(
      `SELECT service, SUM(amount)::float AS total FROM cost_line_items
       WHERE cloud_credential_id = $1 AND usage_date >= date_trunc('month', now())::date
       GROUP BY service ORDER BY total DESC LIMIT 5`,
      [credential.id],
    );
    const topRegions = await queryRunner.query(
      `SELECT COALESCE(region, 'unspecified') AS region, SUM(amount)::float AS total FROM cost_line_items
       WHERE cloud_credential_id = $1 AND usage_date >= date_trunc('month', now())::date
       GROUP BY 1 ORDER BY total DESC LIMIT 5`,
      [credential.id],
    );

    const mtdSpend = mtdRow.total as number;
    const previousMonthTotal =
      (prevRow.total as number) > 0 ? (prevRow.total as number) : null;
    const prevSamePeriod =
      (prevSamePeriodRow.total as number) > 0
        ? (prevSamePeriodRow.total as number)
        : null;

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
      cloudCredentialId: credential.id,
      provider: credential.provider,
      label: credential.label,
      lastPolledAt: credential.last_polled_at,
      previousMonthTotal,
      mtdSpend,
      mtdPctChange: prevSamePeriod
        ? ((mtdSpend - prevSamePeriod) / prevSamePeriod) * 100
        : null,
      forecast: pace ? pace.projectedFullMonth : null,
      forecastPctChange: pace ? pace.pctOverPace : null,
      insightText: pace
        ? generateCostInsightText(credential.label, pace)
        : null,
      trend: trendRows.map((r: { month: string; total: number }) => ({
        month: r.month,
        total: r.total,
      })),
      topServices: topServices.map((r: { service: string; total: number }) => ({
        service: r.service,
        total: r.total,
      })),
      topRegions: topRegions.map((r: { region: string; total: number }) => ({
        region: r.region,
        total: r.total,
      })),
    };
  }
}
