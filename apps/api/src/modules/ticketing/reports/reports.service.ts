import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';

export interface ReportWindow {
  from: string; // ISO date/time
  to: string;
}
type Window = ReportWindow;

/**
 * Read-only ticketing analytics (Freshdesk Analytics parity). Everything is
 * derived on the fly from tickets / ticket_satisfaction_ratings / agents --
 * no reporting tables to keep in sync. All queries are scoped to a
 * created_at window (default: trailing 30 days) and, of course, RLS.
 */
@Injectable()
export class ReportsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private resolveWindow(from?: string, to?: string): Window {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from: fromDate.toISOString(), to: toDate.toISOString() };
  }

  async summary(tenantId: string, from?: string, to?: string) {
    const win = this.resolveWindow(from, to);
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      // Sequential, not Promise.all: these share a single pooled connection, and
      // one pg client can't run concurrent queries.
      const volume = await this.volumeByDay(qr, win);
      const byStatus = await this.countBy(qr, 'status', win);
      const byPriority = await this.countBy(qr, 'priority', win);
      const sla = await this.slaAttainment(qr, win);
      const times = await this.responseTimes(qr, win);
      const csat = await this.csat(qr, win);
      const agents = await this.agentPerformance(qr, win);
      return { window: win, volume, byStatus, byPriority, sla, times, csat, agents };
    });
  }

  private volumeByDay(qr: QueryRunner, win: Window) {
    return qr.query(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
              COALESCE(created.count, 0)::int AS created,
              COALESCE(resolved.count, 0)::int AS resolved
       FROM generate_series($1::date, $2::date, interval '1 day') AS d(day)
       LEFT JOIN (
         SELECT date_trunc('day', created_at)::date AS day, count(*) AS count
         FROM tickets WHERE created_at >= $1 AND created_at <= $2 GROUP BY 1
       ) created ON created.day = d.day
       LEFT JOIN (
         SELECT date_trunc('day', resolved_at)::date AS day, count(*) AS count
         FROM tickets WHERE resolved_at >= $1 AND resolved_at <= $2 GROUP BY 1
       ) resolved ON resolved.day = d.day
       ORDER BY d.day`,
      [win.from, win.to],
    );
  }

  private async countBy(
    qr: QueryRunner,
    column: 'status' | 'priority',
    win: Window,
  ) {
    return qr.query(
      `SELECT ${column} AS key, count(*)::int AS count
       FROM tickets WHERE created_at >= $1 AND created_at <= $2
       GROUP BY 1 ORDER BY count DESC`,
      [win.from, win.to],
    );
  }

  private async slaAttainment(qr: QueryRunner, win: Window) {
    const [row] = await qr.query(
      `SELECT
         count(*) FILTER (WHERE first_response_due_at IS NOT NULL)::int AS fr_total,
         count(*) FILTER (WHERE first_response_due_at IS NOT NULL
                            AND first_response_at IS NOT NULL
                            AND first_response_at <= first_response_due_at)::int AS fr_met,
         count(*) FILTER (WHERE resolution_due_at IS NOT NULL)::int AS res_total,
         count(*) FILTER (WHERE resolution_due_at IS NOT NULL
                            AND resolved_at IS NOT NULL
                            AND resolved_at <= resolution_due_at)::int AS res_met
       FROM tickets WHERE created_at >= $1 AND created_at <= $2`,
      [win.from, win.to],
    );
    const pct = (met: number, total: number) =>
      total > 0 ? Math.round((met / total) * 1000) / 10 : null;
    return {
      firstResponse: { met: row.fr_met, total: row.fr_total, pct: pct(row.fr_met, row.fr_total) },
      resolution: { met: row.res_met, total: row.res_total, pct: pct(row.res_met, row.res_total) },
    };
  }

  private async responseTimes(qr: QueryRunner, win: Window) {
    const [row] = await qr.query(
      `SELECT
         avg(EXTRACT(epoch FROM first_response_at - created_at) / 60.0)
           FILTER (WHERE first_response_at IS NOT NULL) AS fr_avg,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(epoch FROM first_response_at - created_at) / 60.0
         ) FILTER (WHERE first_response_at IS NOT NULL) AS fr_p50,
         avg(EXTRACT(epoch FROM resolved_at - created_at) / 60.0)
           FILTER (WHERE resolved_at IS NOT NULL) AS res_avg,
         percentile_cont(0.5) WITHIN GROUP (
           ORDER BY EXTRACT(epoch FROM resolved_at - created_at) / 60.0
         ) FILTER (WHERE resolved_at IS NOT NULL) AS res_p50
       FROM tickets WHERE created_at >= $1 AND created_at <= $2`,
      [win.from, win.to],
    );
    const round = (v: number | null) =>
      v === null || v === undefined ? null : Math.round(Number(v));
    return {
      firstResponseMinutes: { avg: round(row.fr_avg), median: round(row.fr_p50) },
      resolutionMinutes: { avg: round(row.res_avg), median: round(row.res_p50) },
    };
  }

  private async csat(qr: QueryRunner, win: Window) {
    // rating is a happy/neutral/unhappy enum, so "CSAT" is a positive-share
    // score (Freshdesk-style): happy counts full, neutral half, unhappy zero.
    const rows: { rating: string; count: number }[] = await qr.query(
      `SELECT rating::text AS rating, count(*)::int AS count
       FROM ticket_satisfaction_ratings
       WHERE rated_at >= $1 AND rated_at <= $2
       GROUP BY rating ORDER BY rating`,
      [win.from, win.to],
    );
    const total = rows.reduce((s, r) => s + r.count, 0);
    const weightOf = (r: string) => (r === 'happy' ? 1 : r === 'neutral' ? 0.5 : 0);
    const weighted = rows.reduce((s, r) => s + weightOf(r.rating) * r.count, 0);
    const happy = rows.find((r) => r.rating === 'happy')?.count ?? 0;
    return {
      total,
      // Overall positive-share score, 0-100.
      score: total > 0 ? Math.round((weighted / total) * 1000) / 10 : null,
      positivePct: total > 0 ? Math.round((happy / total) * 1000) / 10 : null,
      distribution: rows,
    };
  }

  private agentPerformance(qr: QueryRunner, win: Window) {
    return qr.query(
      `SELECT a.id AS agent_id, u.name AS agent_name,
              count(t.*) FILTER (WHERE t.resolved_at IS NOT NULL)::int AS resolved,
              round(avg(EXTRACT(epoch FROM t.resolved_at - t.created_at) / 60.0)
                    FILTER (WHERE t.resolved_at IS NOT NULL)) AS avg_resolution_minutes,
              round(avg(CASE s.rating WHEN 'happy' THEN 1.0 WHEN 'neutral' THEN 0.5 ELSE 0 END)
                FILTER (WHERE s.rating IS NOT NULL) * 100) AS csat_score
       FROM agents a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN tickets t ON t.agent_id = a.id AND t.created_at >= $1 AND t.created_at <= $2
       LEFT JOIN ticket_satisfaction_ratings s ON s.ticket_id = t.id
       GROUP BY a.id, u.name
       HAVING count(t.*) > 0
       ORDER BY resolved DESC`,
      [win.from, win.to],
    );
  }
}
