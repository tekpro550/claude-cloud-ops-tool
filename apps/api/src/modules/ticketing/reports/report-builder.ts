import { BadRequestException } from '@nestjs/common';

/**
 * A safe, whitelisted query builder for the custom report builder -- NOT
 * free SQL. Every metric, dimension, and filter field the caller can name is
 * a token that must exist in one of the allowlist maps below; the SQL
 * fragment that token maps to is fixed at compile time here, never built
 * from the caller's string. Every value (filter values, date range bounds)
 * is a bind parameter, never concatenated. buildReportQuery() throws
 * BadRequestException the moment it sees a token outside these maps -- that
 * rejection, not any application-layer sanitization, is what keeps this
 * feature from being a SQL injection surface. See
 * verify-report-builder.ts's "out-of-allowlist token is rejected" checks,
 * which exist specifically to prove that.
 */

export const METRICS = [
  'ticket_count',
  'avg_first_response_minutes',
  'avg_resolution_minutes',
  'sla_attainment_pct',
  'avg_csat',
] as const;
export type ReportMetric = (typeof METRICS)[number];

export const DIMENSIONS = [
  'status',
  'priority',
  'ticket_type_id',
  'group_id',
  'assignee_id',
  'source',
  'day',
  'week',
  'month',
] as const;
export type ReportDimension = (typeof DIMENSIONS)[number];

// Filters share the same field vocabulary as group-by dimensions (any of
// them can be equality-filtered, not just grouped by).
export const FILTER_FIELDS = DIMENSIONS;
export type ReportFilterField = ReportDimension;

export const DATE_FIELDS = ['created_at', 'resolved_at'] as const;
export type ReportDateField = (typeof DATE_FIELDS)[number];

const METRIC_SQL: Record<ReportMetric, string> = {
  ticket_count: 'count(DISTINCT t.id)',
  avg_first_response_minutes: `avg(EXTRACT(epoch FROM t.first_response_at - t.created_at) / 60.0) FILTER (WHERE t.first_response_at IS NOT NULL)`,
  avg_resolution_minutes: `avg(EXTRACT(epoch FROM t.resolved_at - t.created_at) / 60.0) FILTER (WHERE t.resolved_at IS NOT NULL)`,
  sla_attainment_pct: `(count(*) FILTER (WHERE t.resolution_due_at IS NOT NULL AND t.resolved_at IS NOT NULL AND t.resolved_at <= t.resolution_due_at)::float / NULLIF(count(*) FILTER (WHERE t.resolution_due_at IS NOT NULL), 0)::float) * 100`,
  // Same happy=1/neutral=0.5/unhappy=0 weighting reports.service.ts's csat() uses.
  avg_csat: `avg(CASE s.rating WHEN 'happy' THEN 1.0 WHEN 'neutral' THEN 0.5 WHEN 'unhappy' THEN 0.0 ELSE NULL END) * 100`,
};

// Used for both SELECT ... AS bucket / GROUP BY (dimensions) and filter
// equality comparisons (filters) -- same field, same expression either way.
const FIELD_SQL: Record<ReportDimension, string> = {
  status: 't.status::text',
  priority: 't.priority::text',
  ticket_type_id: 't.ticket_type_id::text',
  group_id: 't.group_id::text',
  assignee_id: 't.agent_id::text',
  source: 't.source::text',
  day: `to_char(t.created_at, 'YYYY-MM-DD')`,
  week: `to_char(date_trunc('week', t.created_at), 'YYYY-MM-DD')`,
  month: `to_char(t.created_at, 'YYYY-MM')`,
};

const DATE_FIELD_SQL: Record<ReportDateField, string> = {
  created_at: 't.created_at',
  resolved_at: 't.resolved_at',
};

export interface ReportFilter {
  field: ReportFilterField;
  value: string;
}

export interface ReportDateRange {
  from: string;
  to: string;
}

export interface ReportConfig {
  metric: ReportMetric;
  groupBy: ReportDimension;
  filters?: ReportFilter[];
  dateField?: ReportDateField;
  dateRange?: ReportDateRange;
}

export interface BuiltReportQuery {
  sql: string;
  params: unknown[];
}

function lookup<T extends string>(
  map: Record<T, string>,
  token: string,
  label: string,
): string {
  const sql = (map as Record<string, string>)[token];
  if (!sql) {
    throw new BadRequestException(`Unknown ${label} "${token}"`);
  }
  return sql;
}

export function buildReportQuery(config: ReportConfig): BuiltReportQuery {
  const metricSql = lookup(METRIC_SQL, config.metric, 'metric');
  const dimensionSql = lookup(FIELD_SQL, config.groupBy, 'groupBy dimension');
  const dateFieldSql = lookup(
    DATE_FIELD_SQL,
    config.dateField ?? 'created_at',
    'dateField',
  );

  const params: unknown[] = [];
  const conditions: string[] = [];

  if (config.dateRange) {
    params.push(config.dateRange.from);
    conditions.push(`${dateFieldSql} >= $${params.length}`);
    params.push(config.dateRange.to);
    conditions.push(`${dateFieldSql} <= $${params.length}`);
  }

  for (const filter of config.filters ?? []) {
    const filterSql = lookup(FIELD_SQL, filter.field, 'filter field');
    params.push(filter.value);
    conditions.push(`${filterSql} = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  // Only join the satisfaction table when the metric actually needs it --
  // every other metric reads from tickets alone.
  const join =
    config.metric === 'avg_csat'
      ? 'LEFT JOIN ticket_satisfaction_ratings s ON s.ticket_id = t.id'
      : '';

  const sql = `
    SELECT ${dimensionSql} AS bucket, ${metricSql} AS value
    FROM tickets t
    ${join}
    ${where}
    GROUP BY bucket
    ORDER BY bucket
  `;
  return { sql, params };
}
