# APM + RUM integration guide

This covers how to send data into Cloud Ops Tool's APM (server-side traces)
and RUM (browser real-user monitoring) endpoints. This is an **ingestion +
storage + aggregation** feature, not a language-specific auto-instrumentation
agent — you send trace/span or page-timing data yourself (or via the small
snippets below), and the platform stores it, computes latency percentiles +
apdex (APM) or page-load percentiles + error rate (RUM), and shows it on the
APM/RUM dashboards.

**Out of scope:** auto-instrumentation agents for specific languages/
frameworks, distributed-trace context propagation across service boundaries,
and sampling controls. If you need those, this is the ingestion contract to
target from your own instrumentation.

## APM: server-side traces

1. In Admin → Monitor admin → create an APM ingest key for your service. The
   signed key is shown once — store it as a secret (e.g. `APM_INGEST_KEY`).
2. POST batches of traces to `POST /api/v1/apm/traces` with
   `Authorization: Bearer <key>`. Each trace is one request/transaction;
   `spans` are optional — omit them if you only want request-level timing and
   apdex.

```json
{
  "traces": [
    {
      "transaction": "POST /checkout",
      "durationMs": 340,
      "status": "ok",
      "spans": [
        { "spanId": "handler", "name": "checkout handler", "durationMs": 340 },
        { "spanId": "db", "parentSpanId": "handler", "name": "SELECT orders", "kind": "db", "durationMs": 120 },
        { "spanId": "http", "parentSpanId": "handler", "name": "GET payment-gateway", "kind": "http", "durationMs": 90 }
      ]
    }
  ]
}
```

`spanId`/`parentSpanId` are your own request-scoped identifiers (any string
unique within the trace) — the server resolves them into a real span tree, so
you don't need to know server-generated ids up front.

### Example: Express middleware

```js
const APM_INGEST_KEY = process.env.APM_INGEST_KEY;
const APM_BASE_URL = process.env.APM_BASE_URL ?? "https://your-cloud-ops-tool/api/v1";

function apmTiming(req, res, next) {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    fetch(`${APM_BASE_URL}/apm/traces`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${APM_INGEST_KEY}` },
      body: JSON.stringify({
        traces: [
          {
            transaction: `${req.method} ${req.route?.path ?? req.path}`,
            durationMs,
            status: res.statusCode >= 500 ? "error" : "ok",
          },
        ],
      }),
      // Fire-and-forget: never let telemetry delivery block or fail the response.
    }).catch(() => {});
  });
  next();
}

app.use(apmTiming);
```

## RUM: browser page-load + JS errors

1. In Admin → Monitor admin → create a RUM app key for your site. Unlike the
   other ingest keys, this one is meant to ship inside public, client-side
   JavaScript — it only ever lets someone *write* RUM events into your
   tenant, never read anything back.
2. The browser beacon posts to `POST /api/v1/rum/collect` — this route
   accepts requests from any origin (RUM beacons come from arbitrary
   customer websites, not the app itself), unlike every other endpoint.

```html
<script>
(function () {
  var RUM_APP_KEY = "YOUR_RUM_APP_KEY";
  var RUM_URL = "https://your-cloud-ops-tool/api/v1/rum/collect";

  function send(events) {
    var body = JSON.stringify({ appKey: RUM_APP_KEY, events: events });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(RUM_URL, new Blob([body], { type: "application/json" }));
    } else {
      fetch(RUM_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true });
    }
  }

  window.addEventListener("error", function (e) {
    send([{ page: location.pathname, metric: "js_error", value: 1, attributes: { message: String(e.message) } }]);
  });

  window.addEventListener("load", function () {
    setTimeout(function () {
      var nav = performance.getEntriesByType("navigation")[0];
      var paint = performance.getEntriesByType("paint");
      var events = [];
      if (nav) events.push({ page: location.pathname, metric: "ttfb", value: nav.responseStart });
      var fcp = paint.find(function (p) { return p.name === "first-contentful-paint"; });
      if (fcp) events.push({ page: location.pathname, metric: "fcp", value: fcp.startTime });
      var lcpEntries = performance.getEntriesByType("largest-contentful-paint");
      if (lcpEntries.length) events.push({ page: location.pathname, metric: "lcp", value: lcpEntries[lcpEntries.length - 1].startTime });
      if (events.length) send(events);
    }, 0);
  });
})();
</script>
```

`metric` must be one of `lcp`, `fcp`, `ttfb`, or `js_error` — anything else is
rejected by the ingestion DTO.

## What you get

- **APM dashboard** (`/monitoring/apm`): service list → per-transaction p50/
  p95/p99 latency + apdex + error rate → slowest traces → span waterfall.
- **RUM dashboard** (`/monitoring/rum`): page list → per-page LCP/FCP/TTFB
  percentiles + JS error rate.

Percentiles use nearest-rank (not interpolated) over the samples in the
selected window; apdex uses the standard formula
`(satisfied + tolerating/2) / total` with `satisfied` = duration ≤ T and
`tolerating` = T < duration ≤ 4T (T defaults to 500ms, configurable per
request via `apdexToleratingMs` on the service-stats query).
