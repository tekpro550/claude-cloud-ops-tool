import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { signRumAppJwt, verifyRumAppJwt } from '../../platform/auth/jwt';
import { percentile } from '../apm/apm-percentile';
import { CreateRumAppKeyDto, IngestRumEventDto } from './rum.dto';

const TIMING_METRICS = ['lcp', 'fcp', 'ttfb'] as const;

@Injectable()
export class RumService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // ---- App keys ----

  listAppKeys(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`SELECT * FROM rum_app_keys ORDER BY created_at DESC`),
    );
  }

  createAppKey(tenantId: string, dto: CreateRumAppKeyDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [row] = await queryRunner.query(
        `INSERT INTO rum_app_keys (tenant_id, app_name) VALUES ($1, $2) RETURNING *`,
        [tenantId, dto.appName],
      );
      const token = signRumAppJwt({ sub: row.id, tenantId, kind: 'rum_app' });
      return { ...row, token };
    });
  }

  async removeAppKey(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM rum_app_keys WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`RUM app key ${id} not found`);
      }
    });
  }

  // ---- Ingestion ----

  /**
   * The app key travels in the request body (not an Authorization header --
   * see rum-ingestion.controller.ts's comment on why), so verification
   * happens here rather than in a guard: decode the signed token, then
   * confirm the key is still active within its own tenant before inserting
   * anything.
   */
  async collect(
    appKeyToken: string,
    events: IngestRumEventDto[],
  ): Promise<void> {
    const claims = verifyRumAppJwt(appKeyToken);
    if (!claims) {
      throw new UnauthorizedException('Invalid or expired RUM app key');
    }

    const isActive = await withTenantContext(
      this.dataSource,
      claims.tenantId,
      async (queryRunner) => {
        const [row] = await queryRunner.query(
          `SELECT is_active FROM rum_app_keys WHERE id = $1`,
          [claims.sub],
        );
        return row?.is_active === true;
      },
    );
    if (!isActive) {
      throw new UnauthorizedException(
        'RUM app key has been revoked or no longer exists',
      );
    }
    if (events.length === 0) return;

    await withTenantContext(
      this.dataSource,
      claims.tenantId,
      async (queryRunner) => {
        for (const event of events) {
          await queryRunner.query(
            `INSERT INTO rum_events (tenant_id, rum_app_key_id, ts, page, metric, value, user_agent, attributes)
           VALUES ($1, $2, COALESCE($3::timestamptz, now()), $4, $5, $6, $7, $8)`,
            [
              claims.tenantId,
              claims.sub,
              event.ts ?? null,
              event.page,
              event.metric,
              event.value,
              event.userAgent ?? null,
              JSON.stringify(event.attributes ?? {}),
            ],
          );
        }
      },
    );
  }

  // ---- Aggregation ----

  listPages(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT page, count(*)::int AS event_count, max(ts) AS last_seen_at
         FROM rum_events GROUP BY page ORDER BY page`,
      ),
    );
  }

  async pageStats(
    tenantId: string,
    page: string,
    opts: { from?: string; to?: string } = {},
  ) {
    const rows = await withTenantContext(
      this.dataSource,
      tenantId,
      (queryRunner) => {
        const conditions = [`page = $1`];
        const params: unknown[] = [page];
        if (opts.from) {
          params.push(opts.from);
          conditions.push(`ts >= $${params.length}`);
        }
        if (opts.to) {
          params.push(opts.to);
          conditions.push(`ts <= $${params.length}`);
        }
        return queryRunner.query(
          `SELECT metric, value FROM rum_events WHERE ${conditions.join(' AND ')}`,
          params,
        );
      },
    );

    const byMetric = new Map<string, number[]>();
    let errorCount = 0;
    for (const row of rows) {
      if (row.metric === 'js_error') {
        errorCount++;
        continue;
      }
      const values = byMetric.get(row.metric) ?? [];
      values.push(row.value);
      byMetric.set(row.metric, values);
    }

    // "Page loads" for the error-rate denominator: the count of the timing
    // metric with the most samples (each page load emits at most one of
    // each timing metric, but a slow/blocked page may miss lcp/fcp -- using
    // the max across the three timing metrics is a closer proxy for load
    // count than any single one alone). Documented simplification: there is
    // no dedicated "page view" event.
    const loadCount = Math.max(
      1,
      ...TIMING_METRICS.map((m) => byMetric.get(m)?.length ?? 0),
    );

    const timings = TIMING_METRICS.map((metric) => {
      const values = byMetric.get(metric) ?? [];
      return {
        metric,
        count: values.length,
        p50: percentile(values, 50),
        p95: percentile(values, 95),
      };
    });

    return {
      page,
      timings,
      errorCount,
      errorRatePct: (errorCount / loadCount) * 100,
    };
  }
}
