const TEST_PORT = 32900 + Math.floor(Math.random() * 500);
process.env.PORT = String(TEST_PORT);
// Low cap so the rate-limit assertion below trips deterministically without
// hundreds of requests. The main-flow assertions post far fewer than this
// per key, so it doesn't interfere with them.
const RATE_LIMIT = 5;
process.env.INGEST_MAX_REQUESTS_PER_WINDOW = String(RATE_LIMIT);

import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { ApmService } from '../apm/apm.service';
import { RumService } from '../rum/rum.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`APM/RUM verification FAILED: ${message}`);
  }
  console.log(`  OK  ${message}`);
}

function migratorClient() {
  return new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? 'cloud_ops_tool',
    user: process.env.DB_MIGRATOR_USER ?? 'postgres',
    password: process.env.DB_MIGRATOR_PASSWORD ?? 'postgres',
  });
}

async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `apm-rum-verify-${Date.now()}`;
  const {
    rows: [tenantA],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['APM/RUM Verify A', slug],
  );
  const {
    rows: [tenantB],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['APM/RUM Verify B', `${slug}-b`],
  );

  const app: INestApplication = await NestFactory.create(AppModule, {
    logger: false,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(TEST_PORT);
  const baseUrl = `http://localhost:${TEST_PORT}/api/v1`;

  const apm = app.get(ApmService);
  const rum = app.get(RumService);

  try {
    // ==================== APM ====================

    const apmKey = await apm.createIngestKey(tenantA.id, {
      service: 'checkout-api',
    });
    const decoyApmKey = await apm.createIngestKey(tenantB.id, {
      service: 'other-tenant-service',
    });

    const postTraces = (token: string, traces: unknown[]) =>
      fetch(`${baseUrl}/apm/traces`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ traces }),
      });

    const noAuthRes = await fetch(`${baseUrl}/apm/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ traces: [] }),
    });
    assert(
      noAuthRes.status === 401,
      'trace ingestion without a token is rejected',
    );

    // --- 10 "checkout" traces with hand-computable percentiles/apdex ---
    const durations = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const checkoutTraces = durations.map((durationMs, i) => ({
      transaction: 'checkout',
      durationMs,
      status: i === durations.length - 1 ? 'error' : 'ok',
    }));
    const ingestRes = await postTraces(apmKey.token, checkoutTraces);
    assert(ingestRes.status === 204, 'a batch of traces is accepted (204)');

    const stats = await apm.serviceStats(tenantA.id, 'checkout-api');
    const checkout = stats.transactions.find(
      (t: { transaction: string }) => t.transaction === 'checkout',
    );
    assert(!!checkout, 'the checkout transaction appears in service stats');
    assert(
      checkout.count === 10,
      'transaction count matches the 10 ingested traces',
    );
    assert(
      checkout.p50 === 500,
      `p50 of [100..1000] is 500 (nearest-rank) -- got ${checkout.p50}`,
    );
    assert(
      checkout.p95 === 1000,
      `p95 of [100..1000] is 1000 (nearest-rank) -- got ${checkout.p95}`,
    );
    assert(
      checkout.avg === 550,
      `avg of [100..1000] is 550 -- got ${checkout.avg}`,
    );
    assert(
      Math.abs(checkout.apdex - 0.75) < 1e-9,
      `apdex (5 satisfied + 5 tolerating of 10, T=500ms) is 0.75 -- got ${checkout.apdex}`,
    );
    assert(checkout.errorCount === 1, 'exactly 1 of the 10 traces is an error');
    assert(checkout.errorRatePct === 10, 'error rate is 10%');

    // --- A trace with a 3-level span tree reconstructs by parent id ---
    await postTraces(apmKey.token, [
      {
        transaction: 'checkout',
        durationMs: 333,
        spans: [
          { spanId: 'root', name: 'handler', durationMs: 300 },
          {
            spanId: 'db',
            parentSpanId: 'root',
            name: 'db-query',
            durationMs: 120,
          },
          {
            spanId: 'conn',
            parentSpanId: 'db',
            name: 'db-connect',
            durationMs: 20,
          },
        ],
      },
    ]);
    const { rows: traceRows } = await migrator.query(
      `SELECT id FROM apm_traces WHERE tenant_id = $1 AND duration_ms = 333`,
      [tenantA.id],
    );
    const { trace, spans } = await apm.getTraceWithSpans(
      tenantA.id,
      traceRows[0].id,
    );
    assert(
      !!trace && spans.length === 3,
      'the trace with spans loads back with all 3 spans',
    );
    const handlerSpan = spans.find(
      (s: { name: string }) => s.name === 'handler',
    );
    const dbSpan = spans.find((s: { name: string }) => s.name === 'db-query');
    const connSpan = spans.find(
      (s: { name: string }) => s.name === 'db-connect',
    );
    assert(
      !!handlerSpan && handlerSpan.parent_span_id === null,
      'the root span has no parent',
    );
    assert(
      !!dbSpan && dbSpan.parent_span_id === handlerSpan.id,
      "db-query resolves its client-side parentSpanId to the handler span's real id",
    );
    assert(
      !!connSpan && connSpan.parent_span_id === dbSpan.id,
      'db-connect resolves to db-query as its parent, reconstructing a 3-level tree',
    );

    // --- Token/key scoping: a disabled key is rejected ---
    await apm.removeIngestKey(tenantB.id, decoyApmKey.id);
    const revokedRes = await postTraces(decoyApmKey.token, [
      { transaction: 'x', durationMs: 1 },
    ]);
    assert(
      revokedRes.status === 401,
      "a removed ingest key's token is rejected",
    );

    // --- RLS isolation ---
    const tenantBServices = await apm.listServices(tenantB.id);
    assert(
      !tenantBServices.some(
        (s: { service: string }) => s.service === 'checkout-api',
      ),
      "RLS: tenant B's service list never includes tenant A's service",
    );

    // ==================== RUM ====================

    const rumKey = await rum.createAppKey(tenantA.id, {
      appName: 'marketing-site',
    });

    const postRum = (appKey: string, events: unknown[]) =>
      fetch(`${baseUrl}/rum/collect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appKey, events }),
      });

    const badKeyRes = await postRum('not-a-real-token', [
      { page: '/x', metric: 'lcp', value: 1 },
    ]);
    assert(
      badKeyRes.status === 401,
      'RUM collect with an invalid app key is rejected',
    );

    // --- 5 LCP samples + 1 JS error on /checkout, hand-computable percentiles + error rate ---
    const lcpValues = [1000, 1200, 1400, 1600, 1800];
    const rumEvents = [
      ...lcpValues.map((value) => ({
        page: '/checkout',
        metric: 'lcp',
        value,
      })),
      {
        page: '/checkout',
        metric: 'js_error',
        value: 1,
        attributes: { message: 'TypeError: x is undefined' },
      },
    ];
    const rumRes = await postRum(rumKey.token, rumEvents);
    assert(rumRes.status === 204, 'a batch of RUM events is accepted (204)');

    const pageStats = await rum.pageStats(tenantA.id, '/checkout');
    const lcpStats = pageStats.timings.find(
      (t: { metric: string }) => t.metric === 'lcp',
    );
    assert(
      !!lcpStats && lcpStats.count === 5,
      '5 LCP samples were recorded for /checkout',
    );
    assert(
      lcpStats.p50 === 1400,
      `p50 of [1000..1800] is 1400 (nearest-rank) -- got ${lcpStats.p50}`,
    );
    assert(
      lcpStats.p95 === 1800,
      `p95 of [1000..1800] is 1800 (nearest-rank) -- got ${lcpStats.p95}`,
    );
    assert(
      pageStats.errorCount === 1,
      'exactly 1 JS error was recorded for /checkout',
    );
    assert(pageStats.errorRatePct === 20, 'error rate is 1/5 = 20%');

    // --- RLS isolation for RUM ---
    const tenantBPages = await rum.listPages(tenantB.id);
    assert(
      !tenantBPages.some((p: { page: string }) => p.page === '/checkout'),
      "RLS: tenant B's page list never includes tenant A's RUM data",
    );

    // ==================== Abuse-surface hardening ====================
    // A fresh key so these assertions don't share a rate-limit counter with
    // the main-flow keys above.
    const hardeningKey = await apm.createIngestKey(tenantA.id, {
      service: 'hardening-svc',
    });

    // A malformed timestamp is rejected by the DTO (400), not passed through
    // to a Postgres cast error (500).
    const badTsRes = await postTraces(hardeningKey.token, [
      { transaction: 'x', durationMs: 1, ts: 'not-a-real-timestamp' },
    ]);
    assert(
      badTsRes.status === 400,
      'a malformed trace ts is rejected with 400, not a 500 cast error',
    );

    // An oversized batch is rejected by the DTO's ArrayMaxSize before any
    // insert runs.
    const oversized = Array.from({ length: 1001 }, () => ({
      transaction: 'bulk',
      durationMs: 1,
    }));
    const oversizedRes = await postTraces(hardeningKey.token, oversized);
    assert(
      oversizedRes.status === 400,
      'a batch over the ArrayMaxSize cap (1000) is rejected with 400',
    );

    // The rate limiter (env cap set to RATE_LIMIT above) trips once a key
    // exceeds its per-window budget. Validation failures above never reached
    // the handler, so they didn't count -- the counter starts fresh here.
    const rateStatuses: number[] = [];
    for (let i = 0; i < RATE_LIMIT + 1; i++) {
      const res = await postTraces(hardeningKey.token, [
        { transaction: 'ratecheck', durationMs: 1 },
      ]);
      rateStatuses.push(res.status);
    }
    assert(
      rateStatuses.slice(0, RATE_LIMIT).every((s) => s === 204),
      `the first ${RATE_LIMIT} ingest requests within the window are accepted`,
    );
    assert(
      rateStatuses[RATE_LIMIT] === 429,
      `the request past the per-window cap is rejected with 429 (got ${rateStatuses[RATE_LIMIT]})`,
    );

    console.log('\nAll APM/RUM checks passed.');
  } finally {
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenantA.id]);
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenantB.id]);
    await migrator.end();
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
