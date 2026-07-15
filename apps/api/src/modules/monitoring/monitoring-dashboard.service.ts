import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';

/**
 * Tenant-wide stat tiles + trend for Monitoring, the same "counters and a
 * trend chart" shape Module 1's ticketing dashboard already established
 * (dashboard.service.ts) -- Fleet status stays the entity list (parallel to
 * the ticket list), this is the separate glanceable summary view, per the
 * user's explicit ask for Module 2/3 to each have "their own dashboard".
 *
 * Alert counts here are scoped to monitor_id IS NOT NULL -- alerts is a
 * shared table (Module 3 also writes cost_budget_id-driven rows into it),
 * so this dashboard only ever counts the monitoring-alert half, leaving the
 * cost-alert half to Module 3's own dashboard.
 */
@Injectable()
export class MonitoringDashboardService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  summary(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [resourceRow] = await queryRunner.query(`
        WITH worst AS (
          SELECT r.id,
            (
              SELECT lc.status FROM monitors m2
              LEFT JOIN LATERAL (
                SELECT status FROM monitor_checks mc WHERE mc.monitor_id = m2.id ORDER BY mc.checked_at DESC LIMIT 1
              ) lc ON true
              WHERE m2.resource_id = r.id AND m2.is_enabled = true AND lc.status IS NOT NULL
              ORDER BY CASE lc.status
                WHEN 'down' THEN 0 WHEN 'critical' THEN 1 WHEN 'trouble' THEN 2 WHEN 'up' THEN 3 ELSE 4 END
              LIMIT 1
            ) AS worst_status
          FROM resources r
        )
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE worst_status = 'up')::int AS up,
          count(*) FILTER (WHERE worst_status = 'down')::int AS down,
          count(*) FILTER (WHERE worst_status = 'critical')::int AS critical,
          count(*) FILTER (WHERE worst_status = 'trouble')::int AS trouble,
          count(*) FILTER (WHERE worst_status IS NULL)::int AS none
        FROM worst
      `);

      const [monitorRow] = await queryRunner.query(`
        SELECT count(*)::int AS total, count(*) FILTER (WHERE is_enabled)::int AS enabled FROM monitors
      `);

      const [alertRow] = await queryRunner.query(`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE severity = 'critical')::int AS critical,
          count(*) FILTER (WHERE severity = 'warning')::int AS warning,
          count(*) FILTER (WHERE severity = 'info')::int AS info
        FROM alerts WHERE status IN ('open', 'acknowledged') AND monitor_id IS NOT NULL
      `);

      return {
        resources: {
          total: resourceRow.total,
          up: resourceRow.up,
          down: resourceRow.down,
          critical: resourceRow.critical,
          trouble: resourceRow.trouble,
          none: resourceRow.none,
        },
        monitors: {
          total: monitorRow.total,
          enabled: monitorRow.enabled,
        },
        openAlerts: {
          total: alertRow.total,
          critical: alertRow.critical,
          warning: alertRow.warning,
          info: alertRow.info,
        },
      };
    });
  }

  /** Alerts opened vs. resolved per day -- same {date, created, resolved} shape as the ticketing dashboard's trends(), so it reuses TrendsChart as-is. */
  trends(tenantId: string, days: number) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const openedRows: Array<{ day: Date; count: number }> =
        await queryRunner.query(
          `SELECT date_trunc('day', opened_at)::date AS day, count(*)::int AS count
         FROM alerts WHERE monitor_id IS NOT NULL AND opened_at >= now() - ($1 || ' days')::interval
         GROUP BY day`,
          [days],
        );
      const resolvedRows: Array<{ day: Date; count: number }> =
        await queryRunner.query(
          `SELECT date_trunc('day', resolved_at)::date AS day, count(*)::int AS count
         FROM alerts WHERE monitor_id IS NOT NULL AND resolved_at IS NOT NULL AND resolved_at >= now() - ($1 || ' days')::interval
         GROUP BY day`,
          [days],
        );

      const toKey = (d: Date) => new Date(d).toISOString().slice(0, 10);
      const openedByDay = new Map(
        openedRows.map((r) => [toKey(r.day), r.count]),
      );
      const resolvedByDay = new Map(
        resolvedRows.map((r) => [toKey(r.day), r.count]),
      );

      const result: Array<{ date: string; created: number; resolved: number }> =
        [];
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setUTCHours(0, 0, 0, 0);
        date.setUTCDate(date.getUTCDate() - i);
        const key = date.toISOString().slice(0, 10);
        result.push({
          date: key,
          created: openedByDay.get(key) ?? 0,
          resolved: resolvedByDay.get(key) ?? 0,
        });
      }
      return result;
    });
  }
}
