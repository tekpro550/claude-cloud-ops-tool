import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';

const STATUSES = ['new', 'open', 'pending', 'resolved', 'closed'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

@Injectable()
export class DashboardService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  summary(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const byStatusRows = await queryRunner.query(
        `SELECT status, count(*)::int AS count FROM tickets GROUP BY status`,
      );
      const byPriorityRows = await queryRunner.query(
        `SELECT priority, count(*)::int AS count FROM tickets GROUP BY priority`,
      );

      const byStatus: Record<string, number> = Object.fromEntries(
        STATUSES.map((s) => [s, 0]),
      );
      for (const row of byStatusRows) byStatus[row.status] = row.count;

      const byPriority: Record<string, number> = Object.fromEntries(
        PRIORITIES.map((p) => [p, 0]),
      );
      for (const row of byPriorityRows) byPriority[row.priority] = row.count;

      const [{ overdue_first_response: overdueFirstResponse }] =
        await queryRunner.query(
          `SELECT count(*)::int AS overdue_first_response FROM tickets
         WHERE status NOT IN ('resolved', 'closed') AND first_response_due_at IS NOT NULL AND first_response_at IS NULL AND first_response_due_at < now()`,
        );
      const [{ overdue_resolution: overdueResolution }] =
        await queryRunner.query(
          `SELECT count(*)::int AS overdue_resolution FROM tickets
         WHERE status NOT IN ('resolved', 'closed') AND resolution_due_at IS NOT NULL AND resolved_at IS NULL AND resolution_due_at < now()`,
        );
      // Same definition of "unassigned" needsAttention() already flags in
      // the banner -- surfaced here too as its own tile, since a manager
      // scanning the dashboard shouldn't have to open the banner to see the
      // count.
      const [{ unassigned }] = await queryRunner.query(
        `SELECT count(*)::int AS unassigned FROM tickets
         WHERE status NOT IN ('resolved', 'closed') AND agent_id IS NULL`,
      );

      const totalOpen = STATUSES.filter(
        (s) => s !== 'resolved' && s !== 'closed',
      ).reduce((sum, s) => sum + byStatus[s], 0);

      return {
        byStatus,
        byPriority,
        overdueFirstResponse,
        overdueResolution,
        unassigned,
        totalOpen,
      };
    });
  }

  trends(tenantId: string, days: number) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const createdRows: Array<{ day: Date; count: number }> =
        await queryRunner.query(
          `SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS count
         FROM tickets WHERE created_at >= now() - ($1 || ' days')::interval
         GROUP BY day`,
          [days],
        );
      const resolvedRows: Array<{ day: Date; count: number }> =
        await queryRunner.query(
          `SELECT date_trunc('day', resolved_at)::date AS day, count(*)::int AS count
         FROM tickets WHERE resolved_at IS NOT NULL AND resolved_at >= now() - ($1 || ' days')::interval
         GROUP BY day`,
          [days],
        );

      const toKey = (d: Date) => new Date(d).toISOString().slice(0, 10);
      const createdByDay = new Map(
        createdRows.map((r) => [toKey(r.day), r.count]),
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
          created: createdByDay.get(key) ?? 0,
          resolved: resolvedByDay.get(key) ?? 0,
        });
      }
      return result;
    });
  }

  slaSummary(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [row] = await queryRunner.query(`
        SELECT
          count(*) FILTER (WHERE sla_policy_id IS NOT NULL)::int AS total_with_sla,
          count(*) FILTER (WHERE sla_policy_id IS NOT NULL AND first_response_at IS NOT NULL AND first_response_at <= first_response_due_at)::int AS first_response_met,
          count(*) FILTER (WHERE sla_policy_id IS NOT NULL AND (
            (first_response_at IS NOT NULL AND first_response_at > first_response_due_at) OR
            (first_response_at IS NULL AND first_response_due_at < now())
          ))::int AS first_response_breached,
          count(*) FILTER (WHERE sla_policy_id IS NOT NULL AND resolved_at IS NOT NULL AND resolved_at <= resolution_due_at)::int AS resolution_met,
          count(*) FILTER (WHERE sla_policy_id IS NOT NULL AND (
            (resolved_at IS NOT NULL AND resolved_at > resolution_due_at) OR
            (resolved_at IS NULL AND resolution_due_at < now())
          ))::int AS resolution_breached
        FROM tickets
      `);

      return {
        totalWithSla: row.total_with_sla,
        firstResponse: {
          met: row.first_response_met,
          breached: row.first_response_breached,
          pending:
            row.total_with_sla -
            row.first_response_met -
            row.first_response_breached,
        },
        resolution: {
          met: row.resolution_met,
          breached: row.resolution_breached,
          pending:
            row.total_with_sla - row.resolution_met - row.resolution_breached,
        },
      };
    });
  }

  /**
   * Generic "things this tenant should look at" feed, per section 7's Sprint
   * 4 scope ("built generically now, since Modules 2 and 3 will reuse it").
   * Each item is a {severity, message, count} triple with no ticketing-
   * specific shape in the response contract, so Monitoring/Cost can publish
   * their own items into the same feed later without the frontend banner
   * component needing to change.
   */
  needsAttention(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const items: Array<{
        id: string;
        severity: 'warning' | 'critical';
        message: string;
        count: number;
      }> = [];

      const [{ overdue_first_response: overdueFirstResponse }] =
        await queryRunner.query(
          `SELECT count(*)::int AS overdue_first_response FROM tickets
         WHERE status NOT IN ('resolved', 'closed') AND first_response_due_at IS NOT NULL AND first_response_at IS NULL AND first_response_due_at < now()`,
        );
      if (overdueFirstResponse > 0) {
        items.push({
          id: 'overdue_first_response',
          severity: 'critical',
          message: `${overdueFirstResponse} ticket${overdueFirstResponse === 1 ? '' : 's'} overdue for first response`,
          count: overdueFirstResponse,
        });
      }

      const [{ overdue_resolution: overdueResolution }] =
        await queryRunner.query(
          `SELECT count(*)::int AS overdue_resolution FROM tickets
         WHERE status NOT IN ('resolved', 'closed') AND resolution_due_at IS NOT NULL AND resolved_at IS NULL AND resolution_due_at < now()`,
        );
      if (overdueResolution > 0) {
        items.push({
          id: 'overdue_resolution',
          severity: 'critical',
          message: `${overdueResolution} ticket${overdueResolution === 1 ? '' : 's'} overdue for resolution`,
          count: overdueResolution,
        });
      }

      const [{ unassigned }] = await queryRunner.query(
        `SELECT count(*)::int AS unassigned FROM tickets WHERE status NOT IN ('resolved', 'closed') AND agent_id IS NULL`,
      );
      if (unassigned > 0) {
        items.push({
          id: 'unassigned_tickets',
          severity: 'warning',
          message: `${unassigned} open ticket${unassigned === 1 ? '' : 's'} with no agent assigned`,
          count: unassigned,
        });
      }

      const [{ invalid_email: invalidEmail }] = await queryRunner.query(
        `SELECT count(*)::int AS invalid_email FROM contacts WHERE email_valid = false`,
      );
      if (invalidEmail > 0) {
        items.push({
          id: 'contacts_needing_action',
          severity: 'warning',
          message: `${invalidEmail} contact${invalidEmail === 1 ? '' : 's'} with an invalid email address`,
          count: invalidEmail,
        });
      }

      // Module 2's first real use of this generic feed, per the class doc
      // comment above -- a plain cross-table query rather than a pluggable
      // registration mechanism, since there's no such mechanism built yet
      // and a third module needing the same pattern is what would justify one.
      const [{ open_alerts: openAlerts }] = await queryRunner.query(
        `SELECT count(*)::int AS open_alerts FROM alerts WHERE status IN ('open', 'acknowledged')`,
      );
      if (openAlerts > 0) {
        items.push({
          id: 'open_monitoring_alerts',
          severity: 'critical',
          message: `${openAlerts} open monitoring alert${openAlerts === 1 ? '' : 's'}`,
          count: openAlerts,
        });
      }

      return { items };
    });
  }

  /**
   * Team-wide "who did what, when" feed for the dashboard -- Freshdesk's
   * "Recent activities" panel, per the UI review. Merges three sources into
   * one chronological list the same way getTimeline() merges a single
   * ticket's messages/activities/time-logs: ticket creation (attributed to
   * the requesting contact, since tickets don't track who on the team
   * created them -- Freshdesk's own feed does the same, e.g. "Support Team
   * raised a new ticket"), property changes (attributed to actor_agent_id,
   * added specifically to make this feed possible), and messages
   * (attributed to whichever agent/contact authored them).
   */
  activity(tenantId: string, limit: number) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `
        (
          SELECT 'ticket_created' AS kind, t.id AS ticket_id, t.ticket_number,
                 t.subject, t.created_at AS timestamp,
                 NULL::text AS field, NULL::text AS old_value, NULL::text AS new_value,
                 NULL::text AS message_type, c.name AS actor_name, 'contact' AS actor_kind
          FROM tickets t
          JOIN contacts c ON c.id = t.contact_id
        )
        UNION ALL
        (
          SELECT 'activity' AS kind, t.id, t.ticket_number, t.subject, a.created_at,
                 a.field, a.old_value, a.new_value,
                 NULL, agu.name, 'agent'
          FROM ticket_activities a
          JOIN tickets t ON t.id = a.ticket_id
          LEFT JOIN agents ag ON ag.id = a.actor_agent_id
          LEFT JOIN users agu ON agu.id = ag.user_id
        )
        UNION ALL
        (
          SELECT 'message' AS kind, t.id, t.ticket_number, t.subject, m.created_at,
                 NULL, NULL, NULL,
                 m.type::text, COALESCE(ag2u.name, ct2.name, 'System'), m.author_type::text
          FROM ticket_messages m
          JOIN tickets t ON t.id = m.ticket_id
          LEFT JOIN agents ag2 ON ag2.id = m.author_id AND m.author_type = 'agent'
          LEFT JOIN users ag2u ON ag2u.id = ag2.user_id
          LEFT JOIN contacts ct2 ON ct2.id = m.author_id AND m.author_type = 'contact'
        )
        ORDER BY timestamp DESC
        LIMIT $1
        `,
        [limit],
      ),
    );
  }
}
