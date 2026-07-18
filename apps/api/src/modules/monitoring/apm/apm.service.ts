import { randomUUID } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { signApmIngestJwt } from '../../platform/auth/jwt';
import { computeLatencyStats } from './apm-percentile';
import { CreateApmIngestKeyDto, IngestTraceDto } from './apm.dto';

const DEFAULT_APDEX_TOLERATING_MS = 500;
// When the caller doesn't bound the window, aggregate over a trailing period
// rather than the whole trace history -- serviceStats pulls every matching
// row into Node to compute percentiles, so an unbounded scan would grow with
// total ingested volume. A caller wanting a wider view passes an explicit
// `from`.
const DEFAULT_STATS_WINDOW_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ApmService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // ---- Ingest keys ----

  listIngestKeys(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT * FROM apm_ingest_keys ORDER BY created_at DESC`,
      ),
    );
  }

  createIngestKey(tenantId: string, dto: CreateApmIngestKeyDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [row] = await queryRunner.query(
        `INSERT INTO apm_ingest_keys (tenant_id, service) VALUES ($1, $2) RETURNING *`,
        [tenantId, dto.service],
      );
      const token = signApmIngestJwt({
        sub: row.id,
        tenantId,
        kind: 'apm_ingest',
      });
      return { ...row, token };
    });
  }

  async removeIngestKey(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM apm_ingest_keys WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`APM ingest key ${id} not found`);
      }
    });
  }

  // ---- Ingestion ----

  /**
   * Each trace's spans arrive with a client-assigned spanId (unique within
   * that trace, not globally) so parent/child edges can be expressed
   * without the client knowing server-generated uuids up front. This
   * resolves spanId -> a real uuid before any insert, then writes the
   * whole trace (trace row + all its spans) in one transaction.
   */
  async ingestTraces(
    tenantId: string,
    service: string,
    traces: IngestTraceDto[],
  ): Promise<void> {
    if (traces.length === 0) return;

    await withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      for (const trace of traces) {
        const [traceRow] = await queryRunner.query(
          `INSERT INTO apm_traces (tenant_id, service, transaction, ts, duration_ms, status)
           VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()), $5, $6) RETURNING id`,
          [
            tenantId,
            service,
            trace.transaction,
            trace.ts ?? null,
            trace.durationMs,
            trace.status ?? 'ok',
          ],
        );

        const spans = trace.spans ?? [];
        const spanIdMap = new Map<string, string>();
        for (const span of spans) {
          spanIdMap.set(span.spanId, randomUUID());
        }
        for (const span of spans) {
          const id = spanIdMap.get(span.spanId);
          const parentId = span.parentSpanId
            ? (spanIdMap.get(span.parentSpanId) ?? null)
            : null;
          await queryRunner.query(
            `INSERT INTO apm_spans (id, tenant_id, trace_id, parent_span_id, name, kind, duration_ms, attributes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              id,
              tenantId,
              traceRow.id,
              parentId,
              span.name,
              span.kind ?? 'internal',
              span.durationMs,
              JSON.stringify(span.attributes ?? {}),
            ],
          );
        }
      }
    });
  }

  // ---- Aggregation ----

  listServices(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT service, count(*)::int AS trace_count, max(ts) AS last_seen_at
         FROM apm_traces GROUP BY service ORDER BY service`,
      ),
    );
  }

  async serviceStats(
    tenantId: string,
    service: string,
    opts: { from?: string; to?: string; apdexToleratingMs?: number } = {},
  ) {
    const rows = await withTenantContext(
      this.dataSource,
      tenantId,
      (queryRunner) => {
        const from =
          opts.from ??
          new Date(Date.now() - DEFAULT_STATS_WINDOW_MS).toISOString();
        const conditions = [`service = $1`];
        const params: unknown[] = [service];
        params.push(from);
        conditions.push(`ts >= $${params.length}`);
        if (opts.to) {
          params.push(opts.to);
          conditions.push(`ts <= $${params.length}`);
        }
        return queryRunner.query(
          `SELECT transaction, duration_ms, status FROM apm_traces WHERE ${conditions.join(' AND ')}`,
          params,
        );
      },
    );

    const byTransaction = new Map<
      string,
      { durations: number[]; statuses: string[] }
    >();
    for (const row of rows) {
      const bucket = byTransaction.get(row.transaction) ?? {
        durations: [],
        statuses: [],
      };
      bucket.durations.push(row.duration_ms);
      bucket.statuses.push(row.status);
      byTransaction.set(row.transaction, bucket);
    }

    const apdexToleratingMs =
      opts.apdexToleratingMs ?? DEFAULT_APDEX_TOLERATING_MS;
    const overall = computeLatencyStats(
      rows.map((r: { duration_ms: number }) => r.duration_ms),
      rows.map((r: { status: string }) => r.status),
      apdexToleratingMs,
    );
    const transactions = Array.from(byTransaction.entries()).map(
      ([transaction, bucket]) => ({
        transaction,
        ...computeLatencyStats(
          bucket.durations,
          bucket.statuses,
          apdexToleratingMs,
        ),
      }),
    );
    transactions.sort((a, b) => b.p95 - a.p95);

    return { service, overall, transactions };
  }

  slowestTraces(tenantId: string, service: string, limit = 20) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT * FROM apm_traces WHERE service = $1 ORDER BY duration_ms DESC LIMIT $2`,
        [service, Math.min(Math.max(limit, 1), 100)],
      ),
    );
  }

  async getTraceWithSpans(tenantId: string, traceId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [trace] = await queryRunner.query(
        `SELECT * FROM apm_traces WHERE id = $1`,
        [traceId],
      );
      if (!trace) {
        throw new NotFoundException(`Trace ${traceId} not found`);
      }
      const spans = await queryRunner.query(
        `SELECT * FROM apm_spans WHERE trace_id = $1 ORDER BY duration_ms DESC`,
        [traceId],
      );
      return { trace, spans };
    });
  }
}
