import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { buildDailySpend } from './commitment-coverage';
import { CommitmentKind, recommendCommitment } from './commitment-recommend';

const COMMITMENT_KINDS: CommitmentKind[] = [
  'reserved_instance',
  'savings_plan',
];
const LOOKBACK_DAYS = 30;

interface ScopeRow {
  cloud_credential_id: string;
  service: string;
  region: string | null;
  amounts: number[];
}

/**
 * Periodic sweep (mirrors RightsizingSweepService's idempotency: one upsert
 * per scope+kind, keyed on commitment_recommendations' unique index, rather
 * than accumulating duplicates run after run). Reads on-demand spend
 * straight from cost_line_items -- it does not net out spend already inside
 * an owned commitment's coverage, so a scope with an existing commitment can
 * still show a recommendation for the uncovered remainder's rough shape.
 * That's a disclosed simplification, not an attempt at exact incremental
 * sizing (see commitment-recommend.ts's own doc comment for the rest).
 */
@Injectable()
export class CommitmentSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommitmentSweepService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>(
      'COMMITMENT_SWEEP_INTERVAL_MS',
      21600000, // 6h -- spend patterns move slowly, same cadence as rightsizing
    );
    this.timer = setInterval(() => {
      void this.sweepOnce().catch((err) =>
        this.logger.error(`sweepOnce tick failed: ${(err as Error).message}`),
      );
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweepOnce(): Promise<number> {
    if (this.running) {
      this.logger.warn(
        'commitment sweep already in progress, skipping this tick',
      );
      return 0;
    }
    this.running = true;
    try {
      const tenants = await this.dataSource.query(`SELECT id FROM tenants`);
      let count = 0;
      for (const tenant of tenants) {
        try {
          count += await this.sweepTenant(tenant.id);
        } catch (err) {
          this.logger.error(
            `tenant ${tenant.id} sweep failed: ${(err as Error).message}`,
          );
        }
      }
      return count;
    } finally {
      this.running = false;
    }
  }

  private async sweepTenant(tenantId: string): Promise<number> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const scopes = await this.loadScopes(queryRunner);
      let count = 0;
      for (const scope of scopes) {
        for (const kind of COMMITMENT_KINDS) {
          try {
            if (await this.evaluateScope(queryRunner, tenantId, scope, kind)) {
              count++;
            }
          } catch (err) {
            this.logger.error(
              `commitment recommendation for ${scope.cloud_credential_id}/${scope.service}/${kind} failed: ${(err as Error).message}`,
            );
          }
        }
      }
      return count;
    });
  }

  /**
   * One row per (cloud_credential_id, service, region) with its trailing
   * daily spend, zero-filled the same way CommitmentsService.getCoverage
   * zero-fills a commitment's window -- a quiet day with no cost_line_items
   * row is $0 spend that day, not a day to drop from the baseline.
   */
  private async loadScopes(queryRunner: QueryRunner): Promise<ScopeRow[]> {
    const distinctScopes = await queryRunner.query(`
      SELECT DISTINCT cloud_credential_id, service, region
      FROM cost_line_items
      WHERE usage_date >= CURRENT_DATE - ${LOOKBACK_DAYS}
    `);

    // Yesterday, not today -- a billing sync partway through the day would
    // otherwise show today as an artificially low (incomplete) data point.
    const endDate = new Date();
    endDate.setUTCHours(0, 0, 0, 0);
    endDate.setUTCDate(endDate.getUTCDate() - 1);
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - (LOOKBACK_DAYS - 1));

    const scopes: ScopeRow[] = [];
    for (const row of distinctScopes) {
      const dayRows = await queryRunner.query(
        `SELECT usage_date, SUM(amount)::float AS amount FROM cost_line_items
         WHERE cloud_credential_id = $1 AND service = $2 AND region IS NOT DISTINCT FROM $3
           AND usage_date >= $4 AND usage_date <= $5
         GROUP BY usage_date`,
        [row.cloud_credential_id, row.service, row.region, startDate, endDate],
      );
      scopes.push({
        cloud_credential_id: row.cloud_credential_id,
        service: row.service,
        region: row.region,
        amounts: buildDailySpend(startDate, endDate, dayRows),
      });
    }
    return scopes;
  }

  private async evaluateScope(
    queryRunner: QueryRunner,
    tenantId: string,
    scope: ScopeRow,
    kind: CommitmentKind,
  ): Promise<boolean> {
    const recommendation = recommendCommitment(scope.amounts, kind);

    const [existing] = await queryRunner.query(
      `SELECT id FROM commitment_recommendations
       WHERE cloud_credential_id = $1 AND service = $2 AND region IS NOT DISTINCT FROM $3 AND kind = $4`,
      [scope.cloud_credential_id, scope.service, scope.region, kind],
    );

    if (!recommendation) {
      // Not enough stable usage to recommend -- if a prior recommendation
      // exists for this scope, leave it as-is rather than churn it away on
      // a single quiet sweep (usage histories are noisy; the DB row simply
      // won't be refreshed until there's a real recommendation to replace it
      // with).
      return false;
    }

    if (!existing) {
      await queryRunner.query(
        `INSERT INTO commitment_recommendations (
           tenant_id, cloud_credential_id, kind, service, region,
           recommended_hourly_commitment, estimated_monthly_savings, break_even_months, based_on_days
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          tenantId,
          scope.cloud_credential_id,
          kind,
          scope.service,
          scope.region,
          recommendation.recommendedHourlyCommitment,
          recommendation.estimatedMonthlySavings,
          recommendation.breakEvenMonths,
          recommendation.basedOnDays,
        ],
      );
      return true;
    }

    await queryRunner.query(
      `UPDATE commitment_recommendations SET
         recommended_hourly_commitment = $2, estimated_monthly_savings = $3,
         break_even_months = $4, based_on_days = $5, status = 'open', updated_at = now()
       WHERE id = $1`,
      [
        existing.id,
        recommendation.recommendedHourlyCommitment,
        recommendation.estimatedMonthlySavings,
        recommendation.breakEvenMonths,
        recommendation.basedOnDays,
      ],
    );
    return true;
  }
}
