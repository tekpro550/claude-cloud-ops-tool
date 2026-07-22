import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';

// How long a logged saving sits before the sweep judges whether it actually
// materialized -- long enough for a full billing cycle's worth of post-change
// cost_line_items to land, same 14-day window the rightsizing sweep already
// uses for its own utilization lookback, for one consistent "how long is
// enough to trust a trend" answer across this module rather than two.
const MATERIALIZATION_WINDOW_DAYS = 14;

interface TicketCreatedRecommendationRow {
  id: string;
  tenant_id: string;
  resource_id: string;
  ticket_id: string;
  estimated_monthly_saving: string | null;
}

interface LoggedSavingsRow {
  id: string;
  tenant_id: string;
  resource_id: string;
  expected_monthly_saving: string;
  logged_at: string;
}

/**
 * Module 3 Sprint 5's savings tracking (scope doc section 4/5). Two phases,
 * one job -- "log" and "materialize" are sequential steps of the same
 * lifecycle, not independently-scheduled concerns:
 *
 *   1. Log: a rightsizing_recommendations row with status='ticket_created'
 *      whose linked ticket has since resolved, and that doesn't already
 *      have a cost_savings_log row, gets one -- expected_monthly_saving
 *      copied from the recommendation's own estimate at the time it was
 *      flagged. Reads `tickets` directly by SQL (same precedent
 *      CostAccountsService already set reading `cloud_credentials`
 *      directly) rather than through the internal HTTP contract, which is
 *      reserved for mutations that carry real ticketing business logic
 *      (contact upsert, message creation) -- this is a same-database read.
 *   2. Materialize: a cost_savings_log row still status='logged' more than
 *      MATERIALIZATION_WINDOW_DAYS old gets its actual_monthly_saving filled
 *      in by comparing the resource's cloud account's average daily spend in
 *      the window before logged_at against the window after, divided across
 *      that account's tracked resources the same way the original estimate
 *      was. status becomes 'verified' if spend actually dropped,
 *      'not_materialized' otherwise.
 */
@Injectable()
export class CostSavingsSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CostSavingsSweepService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>(
      'COST_SAVINGS_SWEEP_INTERVAL_MS',
      21600000, // 6h -- same cadence as the rightsizing sweep it follows on from
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

  async sweepOnce(): Promise<{ logged: number; materialized: number }> {
    if (this.running) {
      this.logger.warn(
        'cost savings sweep already in progress, skipping this tick',
      );
      return { logged: 0, materialized: 0 };
    }
    this.running = true;
    try {
      const tenants = await this.dataSource.query(`SELECT id FROM tenants`);
      let logged = 0;
      let materialized = 0;
      for (const tenant of tenants) {
        try {
          const result = await this.sweepTenant(tenant.id);
          logged += result.logged;
          materialized += result.materialized;
        } catch (err) {
          this.logger.error(
            `tenant ${tenant.id} sweep failed: ${(err as Error).message}`,
          );
        }
      }
      return { logged, materialized };
    } finally {
      this.running = false;
    }
  }

  private async sweepTenant(
    tenantId: string,
  ): Promise<{ logged: number; materialized: number }> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const logged = await this.logResolvedRecommendations(
        queryRunner,
        tenantId,
      );
      const materialized = await this.materializeLoggedSavings(queryRunner);
      return { logged, materialized };
    });
  }

  private async logResolvedRecommendations(
    queryRunner: QueryRunner,
    tenantId: string,
  ): Promise<number> {
    const candidates: TicketCreatedRecommendationRow[] =
      await queryRunner.query(`
      SELECT rr.id, rr.tenant_id, rr.resource_id, rr.ticket_id, rr.estimated_monthly_saving
      FROM rightsizing_recommendations rr
      JOIN tickets t ON t.id = rr.ticket_id
      LEFT JOIN cost_savings_log csl ON csl.recommendation_id = rr.id
      WHERE rr.status = 'ticket_created'
        AND t.status IN ('resolved', 'closed')
        AND csl.id IS NULL
    `);

    let count = 0;
    for (const rec of candidates) {
      if (rec.estimated_monthly_saving === null) {
        // No usable estimate for this resource/account -- nothing to log.
        continue;
      }
      try {
        await queryRunner.query(
          `INSERT INTO cost_savings_log (tenant_id, resource_id, recommendation_id, ticket_id, expected_monthly_saving)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            tenantId,
            rec.resource_id,
            rec.id,
            rec.ticket_id,
            rec.estimated_monthly_saving,
          ],
        );
        count++;
      } catch (err) {
        this.logger.error(
          `logging savings for recommendation ${rec.id} failed: ${(err as Error).message}`,
        );
      }
    }
    return count;
  }

  private async materializeLoggedSavings(
    queryRunner: QueryRunner,
  ): Promise<number> {
    const candidates: LoggedSavingsRow[] = await queryRunner.query(
      `SELECT id, tenant_id, resource_id, expected_monthly_saving, logged_at
       FROM cost_savings_log
       WHERE status = 'logged' AND logged_at <= now() - interval '${MATERIALIZATION_WINDOW_DAYS} days'`,
    );

    let count = 0;
    for (const savingsLog of candidates) {
      try {
        if (await this.materializeOne(queryRunner, savingsLog)) count++;
      } catch (err) {
        this.logger.error(
          `materializing savings log ${savingsLog.id} failed: ${(err as Error).message}`,
        );
      }
    }
    return count;
  }

  private async materializeOne(
    queryRunner: QueryRunner,
    savingsLog: LoggedSavingsRow,
  ): Promise<boolean> {
    const [resource] = await queryRunner.query(
      `SELECT cloud_credential_id FROM resources WHERE id = $1`,
      [savingsLog.resource_id],
    );
    const cloudCredentialId = resource?.cloud_credential_id as string | null;
    if (!cloudCredentialId) {
      // No known account to compare against -- leave it logged rather than
      // guessing at a verdict.
      return false;
    }

    const [beforeRow] = await queryRunner.query(
      `SELECT COALESCE(AVG(daily.total), 0)::float AS avg_daily FROM (
         SELECT usage_date, SUM(amount) AS total FROM cost_line_items
         WHERE cloud_credential_id = $1
           AND usage_date >= ($2::timestamptz - ($3 || ' days')::interval)::date
           AND usage_date < $2::date
         GROUP BY usage_date
       ) daily`,
      [cloudCredentialId, savingsLog.logged_at, MATERIALIZATION_WINDOW_DAYS],
    );
    const [afterRow] = await queryRunner.query(
      `SELECT COALESCE(AVG(daily.total), 0)::float AS avg_daily FROM (
         SELECT usage_date, SUM(amount) AS total FROM cost_line_items
         WHERE cloud_credential_id = $1
           AND usage_date >= $2::date
           AND usage_date < ($2::timestamptz + ($3 || ' days')::interval)::date
         GROUP BY usage_date
       ) daily`,
      [cloudCredentialId, savingsLog.logged_at, MATERIALIZATION_WINDOW_DAYS],
    );
    const [countRow] = await queryRunner.query(
      `SELECT COUNT(*)::int AS count FROM resources
       WHERE cloud_credential_id = $1 AND resource_type = 'server'`,
      [cloudCredentialId],
    );

    const resourceCount = countRow.count as number;
    if (resourceCount === 0) return false;

    const beforeMonthly = (beforeRow.avg_daily as number) * 30;
    const afterMonthly = (afterRow.avg_daily as number) * 30;
    const actualMonthlySaving = (beforeMonthly - afterMonthly) / resourceCount;

    const status = actualMonthlySaving > 0 ? 'verified' : 'not_materialized';
    await queryRunner.query(
      `UPDATE cost_savings_log SET status = $2, actual_monthly_saving = $3, verified_at = now() WHERE id = $1`,
      [savingsLog.id, status, actualMonthlySaving],
    );
    return true;
  }
}
