# Implementation Plan — Competitive-Parity Features (v2 roadmap)

This is a build spec for an AI coding agent (Sonnet) to implement the next wave
of features that close gaps against **Freshdesk** (Module 1), **Site24x7**
(Module 2), and **ManageEngine CloudSpend** (Module 3).

Read `CLAUDE.md` first — every rule there is binding. This document assumes it
and only restates what's feature-specific.

---

## 0. Global conventions (apply to EVERY task below)

Non-negotiable patterns, enforced by CI + verify scripts:

- **Tenant data** → always `withTenantContext(dataSource, tenantId, work)` +
  **raw parameterized SQL** via `queryRunner.query(sql, params)`. Never TypeORM
  repositories, never a hand-rolled `WHERE tenant_id =` as the isolation
  mechanism. Model on `groups.service.ts`.
- **New tenant table** → the migration MUST, in the same file:
  1. `CREATE TABLE …` with `tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`.
  2. `GRANT SELECT, INSERT, UPDATE, DELETE … TO app_user;`
  3. `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + a
     `tenant_isolation` policy keyed on
     `NULLIF(current_setting('app.current_tenant', true), '')::uuid`.
  Copy the shape from `1784380000000-CreateChat.ts`.
- **UPDATE/DELETE … RETURNING** returns `[rows, count]` via TypeORM — destructure
  `const [rows] = await qr.query(...)` then use `rows[0]`. Plain INSERT …
  RETURNING returns the rows array directly. (This bit us in `chat.service.ts`.)
- **Migrations** are timestamp-prefixed and applied in filename order. The last
  one is `1784390000000`. Use strictly increasing timestamps; suggested slots
  are given per task. `synchronize` is off — schema only changes via migrations.
- **Secrets at rest** → pgcrypto `pgp_sym_encrypt($val, $key)` /
  `pgp_sym_decrypt(col, $key)`, key from `credentialsEncryptionKey(config)`
  (`monitoring/credentials-crypto.ts`). Never return a secret from an API.
- **Every request body** → a `class-validator` DTO (`*.dto.ts`). The global
  ValidationPipe uses `{ whitelist, forbidNonWhitelisted, transform }`, so
  unknown fields are rejected — the DTO is the contract.
- **Controllers** → `@UseGuards(TenantHeaderGuard)`, read identity with
  `@CurrentTenantId()` / `@CurrentUserId()`, validate path UUIDs with
  `ParseUUIDPipe`, admin-only routes add `RolesGuard` + `@Roles('admin')`,
  deletes return `@HttpCode(204)`.
- **Module boundaries** → a module MUST NOT import another feature module's
  providers. Monitoring/Cost → Ticketing goes over the internal HTTP contract
  (`POST /internal/tickets/from_alert`, `/internal/tickets/:id/notes`, guarded
  by `InternalApiKeyGuard`). The only shared provider is
  `CLOUD_PROVIDER_CLIENT_FACTORY` (exported by MonitoringModule).
- **Verify scripts** are the primary confidence signal. EVERY task ships a
  `verify-*.ts` under the module's `scripts/` + a `<name>:verify` entry in
  `apps/api/package.json`, runnable against `docker compose up -d`. Model on
  `verify-chat.ts` / `verify-auth-mfa-sso.ts`: create a tenant as the migrator
  role, drive the service, `assert(...)` invariants, print `OK`, clean up in
  `finally`, exit non-zero on failure. Swap external deps for in-memory fakes by
  overriding the DI token (see the fake OIDC client in `verify-auth-mfa-sso.ts`).
- **Frontend** → new endpoints become thin typed functions in
  `apps/web/src/lib/apiClient.ts` (or `costApiClient.ts` /
  `monitoringApiClient.ts`), never inline `fetch`. Pages in `src/pages/`, admin
  CRUD in `src/components/admin/`, register routes + nav in `App.tsx`, add
  user-facing strings to `lib/i18n.tsx` (en + es). **api = single quotes**,
  **web/portal = double quotes**.
- **Before pushing**: `pnpm --filter @cloud-ops-tool/api build`, `pnpm lint`,
  the new verify scripts, and `pnpm --filter @cloud-ops-tool/web build`. The
  pre-push hook runs `pnpm preflight` (frozen lockfile + lint).
- **One vertical slice = one commit.** Backend + migration + verify + frontend
  for a single feature, then the next. Keep CI green at every commit.

### Suggested build order (dependencies first)

| # | Task | Module | Effort | Depends on |
|---|---|---|---|---|
| 1 | Auto-assignment strategies | M1 | M | — |
| 2 | Public status pages | M2 | M | — |
| 3 | Metric-threshold + anomaly alert rules | M2 | M | — |
| 4 | RI / Savings-Plan recommendations + coverage | M3 | L | — |
| 5 | Richer forecasting | M3 | M | 4 (shares cost tables) |
| 6 | Scheduled + exported reports | M3 (+M1) | M | 5 |
| 7 | Custom report builder | M1 | L | — |
| 8 | Synthetic browser / transaction monitoring | M2 | L | — |
| 9 | Log management (ingestion + search) | M2 | L | 3 (alert on logs) |
| 10 | APM + RUM ingestion | M2 | XL | 9 |
| 11 | SNMP / network monitoring | M2 | L | 3 |

Ship 1–6 first (highest impact-to-effort). 8–11 are larger platform builds;
each is independently shippable behind its own verify script.

---

# MODULE 1 — Ticketing (vs Freshdesk)

## Task 1 — Auto-assignment strategies

**Parity target:** Freshdesk's round-robin / load-based / skill-based automatic
ticket assignment to agents within a group.

**Migration** (`1784400000000-AddAssignmentStrategies`):
- `ALTER TABLE groups ADD COLUMN assignment_strategy text NOT NULL DEFAULT 'manual' CHECK (assignment_strategy IN ('manual','round_robin','load_based','skill_based'))`,
  `ADD COLUMN max_open_tickets_per_agent int` (nullable cap for load balancing).
- `CREATE TABLE agent_skills (id, tenant_id, agent_id uuid REFERENCES agents(id) ON DELETE CASCADE, skill text, UNIQUE(tenant_id, agent_id, skill))` + RLS.
- `ALTER TABLE tickets ADD COLUMN required_skill text` (nullable; set by ticket
  type or automation).
- `CREATE TABLE group_assignment_cursor (tenant_id, group_id uuid, last_agent_id uuid, PRIMARY KEY(tenant_id, group_id))` + RLS — persists round-robin position.

**Backend** — new `ticketing/assignment/` folder:
- `assignment.service.ts` → `pickAssignee(tenantId, groupId, requiredSkill?)`:
  resolve the group's strategy, then within `withTenantContext`:
  - `round_robin`: order active agents in the group by id, pick the one after
    `group_assignment_cursor.last_agent_id` (wrap around), update the cursor in
    the same transaction.
  - `load_based`: `SELECT agent, count(open tickets) … ORDER BY count ASC` among
    group agents, skip any at/above `max_open_tickets_per_agent`, tie-break by id.
  - `skill_based`: filter group agents to those with a matching `agent_skills`
    row for `requiredSkill`, then fall back to load-based among them.
  - `manual`: return null (no auto-assign).
  Returns `agentId | null`.
- Wire it in at ticket creation and on group-change:
  `TicketsService.create` (and the existing automation `apply-action.ts`
  "assign to group" path) calls `assignment.pickAssignee(...)` when the resolved
  group has a non-manual strategy and the ticket has no explicit assignee.
- `agent-skills.controller.ts` + `.service.ts` + `.dto.ts` — admin CRUD for
  skills (`@Roles('admin')`). Add `assignmentStrategy` + `maxOpenTicketsPerAgent`
  to the existing groups DTO/service.

**Frontend:**
- `GroupsAdmin.tsx` — strategy `<select>` + max-open input.
- New `AgentSkillsAdmin.tsx` card in the Admin "Team" group.
- `apiClient.ts` — `listAgentSkills / addAgentSkill / removeAgentSkill`, extend
  group upsert type.

**Verify** (`verify-assignment.ts`): seed a group + 3 agents; assert round-robin
cycles 1→2→3→1 and persists across calls; load-based picks the least-loaded and
respects the cap; skill-based only picks skilled agents and 404/nulls when none
match; `manual` returns null.

**Acceptance:** creating a ticket into a round-robin group assigns agents in
rotation; changing a group's strategy takes effect on the next assignment; RLS
isolates skills and cursors per tenant.

---

## Task 7 — Custom report builder

**Parity target:** Freshdesk custom reports — user-defined metric + grouping +
filter + date range over tickets, saved and re-runnable.

**Design:** a **safe, whitelisted query builder** — NOT free SQL. The DTO
constrains every dimension to an allowlist; the service maps allowlisted tokens
to column expressions, so no user string ever reaches SQL as an identifier.

**Migration** (`1784460000000-CreateReportDefinitions`):
- `CREATE TABLE report_definitions (id, tenant_id, name, config jsonb NOT NULL, created_by uuid, created_at, updated_at)` + RLS.
  `config` = `{ metric, groupBy, filters, dateField, dateRange }`.

**Backend** — extend `ticketing/reports/`:
- `report-builder.ts` (pure): allowlists —
  - `METRICS`: `ticket_count`, `avg_first_response_minutes`,
    `avg_resolution_minutes`, `sla_attainment_pct`, `avg_csat`.
  - `DIMENSIONS`: `status`, `priority`, `ticket_type_id`, `group_id`,
    `assignee_id`, `source`, `day`, `week`, `month`.
  - `FILTER_FIELDS`: same set + value bind params.
  Function `buildReportQuery(config) → { sql, params }` composes a parameterized
  `SELECT <dimension expr> AS bucket, <metric expr> AS value FROM tickets … WHERE <filters> GROUP BY bucket ORDER BY bucket`. Every identifier comes from the
  allowlist maps; every value is a bind param. Throw `BadRequestException` on any
  token not in the allowlist.
- `report-definitions.service.ts` → CRUD + `run(tenantId, id)` /
  `preview(tenantId, config)` (run without saving), both via `withTenantContext`.
- `report-definitions.controller.ts` under `@Controller('reports/custom')`.
- `report-definitions.dto.ts` — `ReportConfigDto` with `@IsIn(METRICS)` etc.,
  nested `filters` validated element-by-element.

**Frontend:**
- `ReportBuilderPage.tsx` (route `/reports/builder`): pickers for metric /
  group-by / filters / date range, a **Preview** button (renders a table + a
  simple bar chart), and **Save**. List saved reports; open one to re-run.
- Reuse the existing chart styling; keep it dependency-free (CSS bars or inline
  SVG) unless a chart lib is already vendored.
- `apiClient.ts` — `listReportDefinitions / saveReportDefinition /
  runReportDefinition / previewReport`.

**Verify** (`verify-report-builder.ts`): seed tickets across statuses/priorities/
dates; assert `ticket_count` grouped by `status` matches hand-counted rows;
`avg_resolution_minutes` grouped by `month` bucketises correctly; a filter
narrows results; an **out-of-allowlist metric/dimension is rejected** (this is
the security-critical assertion — proves no SQL injection surface); a saved
definition re-runs identically.

**Acceptance:** an admin builds "ticket_count by status, last 30 days, priority=high",
previews, saves, and re-runs it; malformed configs 400 instead of executing.

**Out of scope:** cross-module reports (monitoring/cost) — Task 6 covers
scheduling/export which can later wrap these.

---

# MODULE 2 — Monitoring (vs Site24x7)

## Task 2 — Public status pages

**Parity target:** Site24x7 public status pages — a shareable page showing the
up/down state and uptime of a chosen set of monitors, no auth.

**Migration** (`1784410000000-CreateStatusPages`):
- `CREATE TABLE status_pages (id, tenant_id, slug text NOT NULL, title, description, is_public boolean DEFAULT true, created_at)` with `UNIQUE(slug)` **globally** (slug is the public key) + RLS for tenant-scoped management.
- `CREATE TABLE status_page_monitors (id, tenant_id, status_page_id uuid, monitor_id uuid, display_name, sort_order int)` + RLS.

**Backend** — `monitoring/status-pages/`:
- `status-pages.service.ts` — admin CRUD (`withTenantContext`) + a **public**
  read `getPublicStatus(slug)` that runs OUTSIDE tenant context: it resolves the
  page by unique slug (as the app role, but the query is by slug not tenant), then
  loads each linked monitor's latest `monitor_checks` status and computes a
  rolling uptime % (e.g. last 90 days from `monitor_checks`). Because this path
  is unauthenticated, it must **only** ever return the whitelisted display fields
  (name, status, uptime) — never monitor internals, config, or tenant ids.
  - RLS note: the public read needs rows across the tenant boundary keyed by a
    non-tenant column. Implement it by setting the tenant context to the page's
    owning tenant once the slug is resolved (resolve slug → tenant_id via a
    `SECURITY DEFINER` helper or a dedicated migrator-owned read), then read
    normally. Document the chosen approach in the service header. Do NOT weaken
    RLS on the underlying tables.
- `status-pages.controller.ts` — admin routes under
  `@Controller('status-pages')` (TenantHeaderGuard + `@Roles('admin')` for
  writes). Public route under a **separate** `StatusPagePublicController`
  (`@Controller('public/status')`, **no guard**): `GET /public/status/:slug`.

**Frontend:**
- `StatusPagesAdmin.tsx` (Admin, Monitor group): create pages, pick monitors,
  set display names/order, copy the public URL.
- `StatusPage.tsx` public page (route `/status/:slug`) — renders without the app
  chrome/auth; polls `GET /public/status/:slug` every ~60s; shows a green/red row
  per component + uptime %. Consider a minimal standalone layout.
- `monitoringApiClient.ts` — admin CRUD + the public fetch.

**Verify** (`verify-status-pages.ts`): create a page with 2 monitors; write
`monitor_checks` rows (one up, one down); assert the public read returns exactly
those 2 components with correct status + a plausible uptime %, exposes **no**
tenant_id/config field, and 404s an unknown slug; assert a second tenant's
monitors can't be attached to this tenant's page (RLS on the link table).

**Acceptance:** an admin publishes a status page reachable unauthenticated at
`/status/<slug>` that reflects live monitor state; the JSON payload contains only
display fields.

---

## Task 3 — Metric-threshold + anomaly alert rules ("monitor-status-based" upgrade)

**Context:** today alert rules fire only on monitor **status** transitions
(`condition.statusIn`), with thresholds buried in monitor config. This adds a
real **metric-rule engine**: fire when a numeric metric crosses a threshold, or
deviates anomalously from its recent baseline.

**Migration** (`1784420000000-ExtendAlertRules`):
- `ALTER TABLE alert_rules ADD COLUMN rule_kind text NOT NULL DEFAULT 'status' CHECK (rule_kind IN ('status','threshold','anomaly'))`,
  `ADD COLUMN metric text`, `ADD COLUMN comparator text CHECK (comparator IN ('gt','gte','lt','lte'))`,
  `ADD COLUMN threshold double precision`, `ADD COLUMN for_consecutive int DEFAULT 1`,
  `ADD COLUMN anomaly_sensitivity double precision`.
  (Existing rows default to `'status'` — backward compatible.)

**Backend** — extend `alert-evaluation.service.ts`:
- Keep the existing status path. Add:
  - `threshold`: read the monitor's recent `monitor_checks` metric samples
    (metric name in the check payload — CPU/mem/disk/latency/response_time);
    open an alert when the last `for_consecutive` samples all satisfy
    `value <comparator> threshold`; resolve when they no longer do.
  - `anomaly`: compute a rolling mean + stddev over a trailing window (e.g. 30
    samples) excluding the newest; fire when
    `|latest - mean| > anomaly_sensitivity * stddev` (default sensitivity ~3).
    Pure function `detect-anomaly.ts` (mirror `cost-anomaly-detect.ts`), unit-
    covered so the statistics are testable without a DB.
- Alerts still flow to the existing escalation/notification pipeline unchanged.
- Extend `alert-rules.dto.ts` with the new fields (conditionally required by
  `rule_kind`).

**Frontend:** `AlertRulesAdmin.tsx` — a rule-kind toggle revealing metric /
comparator / threshold / consecutive (threshold) or metric / sensitivity
(anomaly). Extend the apiClient rule type.

**Verify** (`verify-metric-alert-rules.ts`): feed synthetic `monitor_checks`
series; assert a threshold rule opens only after `for_consecutive` breaches and
auto-resolves; an anomaly rule fires on an injected spike but not on
normal-variance noise; a status rule still behaves exactly as before (regression).

**Acceptance:** an admin creates "CPU > 90% for 3 checks" and "latency anomaly"
rules that open/resolve alerts correctly; existing status rules unaffected.

---

## Task 8 — Synthetic browser / transaction monitoring

**Parity target:** Site24x7 web-transaction / real-browser monitoring — scripted
multi-step flows run in a headless browser, timed, alerting on failure or slow
steps.

**Runtime:** Playwright + Chromium are already available in this environment
(`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, do NOT run `playwright install`).
Add `playwright` to `apps/api` deps (regenerate the lockfile) OR isolate the
browser runner in a small worker — prefer the in-process runner behind an
injectable token so verify can fake it.

**Migration** (`1784470000000-AddSyntheticMonitors`):
- Extend `MONITOR_TYPES` handling to include `'synthetic'` (no enum change if
  `monitor_type` is text; otherwise `ALTER TYPE`). Store the script in
  `monitors.config` as an ordered step array:
  `{ steps: [{ action: 'goto'|'click'|'fill'|'expectText', selector?, url?, value? }], maxStepMs }`.
- `CREATE TABLE synthetic_run_steps (id, tenant_id, monitor_check_id uuid, step_index int, action text, status text, duration_ms int, error text)` + RLS — per-step timings for the waterfall UI.

**Backend** — `monitoring/synthetic/`:
- `SYNTHETIC_RUNNER` DI token + `PlaywrightSyntheticRunner` implementing
  `run(steps, opts) → { ok, steps: StepResult[], totalMs }`. Launch with
  `executablePath` pointing at the pre-installed Chromium; enforce per-step
  timeouts with the existing `with-timeout.ts` pattern.
- A `SyntheticSchedulerService` (mirror `MonitorSchedulerService`) that polls due
  `synthetic` monitors, runs the script, writes a `monitor_checks` row (up/down +
  totalMs) and `synthetic_run_steps` rows, and lets the existing alert-evaluation
  path fire.
- DTO validates the step array against an action allowlist.

**Frontend:** a script builder in `ResourcesAdmin`/monitor create (add-step UI),
and a **waterfall** on the resource dashboard showing per-step timings + the
failing step.

**Verify** (`verify-synthetic.ts`): inject a **fake** `SYNTHETIC_RUNNER` (no real
browser) returning scripted step results; assert a passing script writes an "up"
check with step rows, a failing step writes "down" with the error captured on the
right step index, and a slow step over `maxStepMs` marks failure. (Optionally one
real-Chromium smoke test behind an env flag.)

**Acceptance:** a scripted login-flow monitor runs on schedule, records step
timings, and alerts when a step breaks — verifiable with the fake runner in CI.

---

## Task 9 — Log management (ingestion + search + log-based alerts)

**Parity target:** Site24x7 log management — ingest app/server logs, search/
filter them, and alert on patterns.

**Migration** (`1784480000000-CreateLogManagement`):
- `CREATE TABLE log_sources (id, tenant_id, name, token_hash text, is_active boolean)` + RLS — an ingest token per source (hashed like agent tokens).
- `CREATE TABLE log_entries (id, tenant_id, log_source_id uuid, ts timestamptz, level text, message text, attributes jsonb)` + RLS. Index `(tenant_id, log_source_id, ts DESC)` and a GIN index on `to_tsvector('english', message)` for search. Add a retention note (a sweep can prune old rows).
- `CREATE TABLE log_alert_rules (id, tenant_id, log_source_id, match_query text, level_at_least text, window_seconds int, threshold int, escalation_policy_id uuid)` + RLS.

**Backend** — `monitoring/logs/`:
- `log-ingestion.controller.ts` — `POST /logs/ingest` guarded by a new
  `LogSourceTokenGuard` (bearer ingest token → source + tenant), accepts a batch
  of entries; resolves tenant from the token and inserts under
  `withTenantContext`. Mirror `agent-ingestion` + `agent-token.guard.ts`.
- `logs.service.ts` — `search(tenantId, { sourceId?, level?, q?, from?, to?, limit })`
  using `plainto_tsquery` over the tsvector index; `listSources` / CRUD.
- `log-alert-sweep.service.ts` — periodic sweep: for each rule, count matching
  entries in the trailing `window_seconds`; if `>= threshold`, raise an alert
  through the existing escalation pipeline (or open a ticket via the internal
  contract for `critical`).
- `logs.controller.ts` — search + source CRUD (agent-facing).

**Frontend:** a `LogsPage.tsx` (route `/monitoring/logs`) — source picker, level
filter, full-text search box, virtual[-ish] result list with timestamp/level/
message; a `LogSourcesAdmin` card (create source → show ingest token once). Log-
alert rules admin card.

**Verify** (`verify-logs.ts`): create a source; ingest entries via the service;
assert full-text search matches by keyword and filters by level/time; assert a
log-alert rule fires when the threshold is crossed in the window and not below it;
RLS hides one tenant's logs from another; the ingest token maps to exactly one
source/tenant.

**Acceptance:** logs ingested via token are searchable and drive threshold alerts;
tokens and entries are tenant-isolated.

**Out of scope:** log parsing/pipelines, archival to object storage (note as
follow-ups).

---

## Task 10 — APM + RUM ingestion

**Parity target:** Site24x7 APM Insight (server-side traces, DB/HTTP spans,
apdex) + RUM (browser page-load + JS-error telemetry). This is an **ingestion +
storage + aggregation** build, not an agent SDK — provide the endpoints + a small
browser snippet and a server middleware example; deep language agents are out of
scope.

**Migration** (`1784490000000-CreateApmRum`):
- `CREATE TABLE apm_traces (id, tenant_id, service text, transaction text, ts, duration_ms int, status text, root boolean)` + RLS.
- `CREATE TABLE apm_spans (id, tenant_id, trace_id uuid, parent_span_id uuid, name, kind text, duration_ms int, attributes jsonb)` + RLS.
- `CREATE TABLE rum_events (id, tenant_id, app_key text, ts, page text, metric text, value double precision, user_agent, attributes jsonb)` + RLS — page-load timings (LCP/FCP/TTFB) + JS errors.
- Ingest keys: reuse the `log_sources`-style token table or add
  `apm_ingest_keys` / `rum_app_keys`.

**Backend** — `monitoring/apm/` + `monitoring/rum/`:
- Ingestion controllers (token-guarded, like logs): `POST /apm/traces` (batch of
  trace+spans), `POST /rum/collect` (public-ish, app-key scoped, CORS-aware —
  RUM beacons come from browsers; validate app_key → tenant, rate-limit).
- Aggregation services: apdex + p50/p95/p99 latency per service/transaction over
  a window; RUM page-load percentiles + error rate per page.
- `apm-dashboard.controller.ts` / `rum-dashboard.controller.ts` (agent-facing
  reads).
- Provide `docs/apm-rum-integration.md` with a copy-paste Express middleware
  (server timing → `POST /apm/traces`) and a `<script>` RUM beacon snippet.

**Frontend:** an APM dashboard (service list → transaction latency percentiles →
slowest traces → span waterfall) and a RUM dashboard (page performance + error
rate). New nav entries under Monitoring.

**Verify** (`verify-apm-rum.ts`): ingest synthetic traces/spans + RUM events;
assert percentile + apdex aggregation matches hand-computed values; assert the
span tree reconstructs from parent ids; assert RUM percentiles/error-rate per
page; RLS isolation; token/app-key scoping.

**Acceptance:** traces and RUM beacons ingest via token, aggregate into latency
percentiles/apdex and page-performance dashboards, tenant-isolated.

**Out of scope (state honestly in code + CLAUDE.md):** language-specific auto-
instrumentation agents, distributed-trace context propagation across services,
sampling controls — ship the ingestion contract + storage + aggregation only.

---

## Task 11 — SNMP / network monitoring

**Parity target:** Site24x7 network monitoring — poll SNMP-capable devices
(routers/switches) for interface up/down, throughput, device health.

**Migration** (`1784500000000-CreateNetworkMonitoring`):
- `CREATE TABLE network_devices (id, tenant_id, name, host, snmp_version text, community_encrypted bytea, port int DEFAULT 161, is_active boolean)` + RLS (community string encrypted at rest).
- `CREATE TABLE network_interface_samples (id, tenant_id, network_device_id uuid, if_index int, if_name text, oper_status text, in_octets bigint, out_octets bigint, ts)` + RLS.

**Backend** — `monitoring/network/`:
- `SNMP_CLIENT` DI token + a real client (add `net-snmp` dep, regen lockfile) that
  GET/WALKs the standard IF-MIB OIDs (`ifOperStatus`, `ifInOctets`,
  `ifOutOctets`, `ifDescr`). Behind the token so verify uses a fake.
- `NetworkPollerService` (mirror `CloudResourcePollerService`) — polls active
  devices, writes interface samples, derives per-interface throughput (delta
  octets / delta time), and can raise alerts (interface down / saturation) via
  the alert pipeline (ties into Task 3's threshold rules).
- `network-devices.controller.ts` admin CRUD (encrypted community, never
  returned).

**Frontend:** `NetworkDevicesAdmin` card + a network dashboard (device → interface
table with status + throughput sparklines).

**Verify** (`verify-network.ts`): inject a **fake** `SNMP_CLIENT` returning
scripted IF-MIB values; assert samples are written, throughput is computed from
consecutive polls, an interface flipping to `down` opens an alert; community
string round-trips through encryption and is never returned by the API; RLS
isolation.

**Acceptance:** an SNMP device is polled on schedule, interface status/throughput
recorded, alerts fire on interface-down — all verifiable with the fake client.

---

# MODULE 3 — Cost / FinOps (vs CloudSpend)

## Task 4 — RI / Savings-Plan recommendations + coverage + utilization

**Parity target:** CloudSpend commitment management — recommend Reserved
Instances / Savings Plans from on-demand usage, and report coverage +
utilization of existing commitments.

**Migration** (`1784430000000-CreateCommitments`):
- `CREATE TABLE commitments (id, tenant_id, cost_account_id uuid, kind text CHECK (kind IN ('reserved_instance','savings_plan')), scope text, instance_family text, region text, term_months int, payment_option text, hourly_commitment numeric, start_date date, end_date date)` + RLS — the tenant's active purchases.
- `CREATE TABLE commitment_utilization (id, tenant_id, commitment_id uuid, period date, covered_hours numeric, committed_hours numeric, utilization_pct numeric, wasted_amount numeric)` + RLS.
- `CREATE TABLE commitment_recommendations (id, tenant_id, cost_account_id uuid, kind text, instance_family text, region text, term_months int, payment_option text, recommended_hourly numeric, estimated_monthly_savings numeric, break_even_months numeric, based_on_days int, generated_at)` + RLS.

**Backend** — `cost/commitments/`:
- `commitment-recommend.ts` (pure) — input: trailing on-demand usage from
  `cost_line_items` grouped by instance_family/region; output: recommended
  commitment level (e.g. cover the stable baseline = some percentile of hourly
  usage), estimated savings (on-demand rate − commitment rate × covered hours),
  and break-even. Keep the pricing model in a small table/const so it's testable;
  document assumptions. Mirror `cost-savings-estimate.ts`.
- `commitment-coverage.ts` (pure) — given commitments + usage for a period,
  compute covered vs on-demand hours → **coverage %**; given commitments +
  actually-used commitment hours → **utilization %** + wasted spend.
- `CommitmentSweepService` (mirror `RightsizingSweepService`) — periodically
  recompute recommendations + utilization from synced billing data.
- `commitments.service.ts` / `.controller.ts` (`@Controller('cost/commitments')`)
  — CRUD for owned commitments, list recommendations, coverage/utilization reads.

**Frontend:** a "Commitments" page (or tab on the cost dashboard): recommendations
table (kind, family, est. savings, break-even) with a "why" explanation; a
coverage/utilization panel (gauges + a trend). Reuse `RecommendationsPage`
patterns.

**Verify** (`verify-commitments.ts`): seed `cost_line_items` with a steady
on-demand baseline; assert a recommendation is produced with plausible savings +
break-even; add a commitment and assert coverage % rises and on-demand recommend
level drops; assert utilization + wasted-spend math on a partially-used
commitment; RLS isolation.

**Acceptance:** stable usage yields an RI/SP recommendation with savings +
break-even; owned commitments report coverage % and utilization %/waste.

---

## Task 5 — Richer forecasting

**Parity target:** CloudSpend forecasted spend — month-end and multi-month
projections with trend, beyond today's linear pace.

**Migration** (`1784440000000-CreateCostForecasts`): optional cache table
`cost_forecasts (id, tenant_id, cost_account_id uuid, horizon_month date, projected_amount numeric, low numeric, high numeric, method text, generated_at)` + RLS. (Can also compute on-read; cache if the dashboard call gets heavy.)

**Backend** — `cost/forecasting/`:
- `forecast.ts` (pure) — take historical daily/monthly `cost_line_items` and
  produce projections with a **confidence band**:
  - month-end run-rate (improve current `cost-pace.ts`: seasonality-aware —
    weekday/weekend weighting),
  - linear regression trend over trailing N months for multi-month horizon,
  - a low/high band from residual variance.
  Keep methods pure + unit-testable; expose a `method` label.
- Extend `cost-dashboard.service.ts` with `forecast(tenantId, accountId?,
  horizonMonths)`; add a controller route.

**Frontend:** add a forecast line + shaded band to the cost dashboard chart;
show projected month-end vs budget with the confidence range.

**Verify** (`verify-cost-forecast.ts`): feed a known linear + noisy series; assert
the month-end projection is within tolerance of the analytic answer, the band
contains the true value, and a rising trend projects higher than flat pace. Keep
the existing `cost-pace` verify green (regression).

**Acceptance:** the dashboard shows a forecast with a confidence band that beats
naive linear pace on a trending series.

---

## Task 6 — Scheduled + exported reports

**Parity target:** CloudSpend (and Freshdesk) scheduled reports — generate a
report on a cron, export CSV/PDF, and email it to recipients.

**Migration** (`1784450000000-CreateScheduledReports`):
- `CREATE TABLE scheduled_reports (id, tenant_id, name, report_kind text, params jsonb, format text CHECK (format IN ('csv','pdf')), cadence text CHECK (cadence IN ('daily','weekly','monthly')), recipients text[], last_run_at, next_run_at, is_active boolean)` + RLS.
- `report_kind` dispatches to a generator: cost dashboard, cost by service/tag,
  commitment coverage (Task 4), or a saved **custom ticket report** (Task 7) by id.

**Backend** — a small `reporting/` area (or per-module generators + a shared
scheduler):
- `report-export.ts` — pure serializers: rows → CSV; rows → a simple PDF (use a
  dependency-light generator, or HTML→PDF via the already-present Chromium /
  Playwright — reuse the synthetic runner's browser to print HTML to PDF, keeping
  deps minimal). Return a `Buffer` + content-type.
- `ScheduledReportSweepService` (mirror the cost sweeps) — find due reports, run
  the generator under `withTenantContext`, render to the chosen format, and email
  via `NotificationsService.enqueue({ channel: 'email', … })` with the file as an
  attachment (extend the email channel to accept attachments if it doesn't yet).
- `scheduled-reports.controller.ts` — CRUD + `POST /:id/run-now` (returns the
  file for immediate download) under `@Roles('admin')`.
- **Boundary:** if a ticket custom report (Task 7) is scheduled, the cost/reporting
  scheduler must reach ticketing over the **internal HTTP contract**, not a direct
  import — add an internal read endpoint `GET /internal/reports/custom/:id/run`
  guarded by `InternalApiKeyGuard`, or place the shared scheduler in a neutral
  module. Do not cross-import feature services.

**Frontend:** a `ScheduledReportsAdmin` card — pick report kind + params +
cadence + format + recipients; a "Run now / download" button that streams the
file (multipart/blob is a documented apiClient exception).

**Verify** (`verify-scheduled-reports.ts`): create a scheduled report; assert the
generator produces well-formed CSV (parse it back, check headers/rows) and a
non-empty PDF buffer; assert the sweep marks due reports run and advances
`next_run_at`; inject a **fake email channel** and assert it's enqueued with the
attachment; RLS isolation. Cross-module path: assert the internal endpoint (not a
direct import) is used for ticket reports.

**Acceptance:** an admin schedules "monthly cost-by-service CSV to finance@…",
runs it now to download, and the sweep emails it on cadence.

---

## Definition of done (every task)

1. Migration applies cleanly (`migration:run`) and reverts (`migration:revert`);
   RLS enabled+forced+policy+grants on new tenant tables.
2. `pnpm --filter @cloud-ops-tool/api build` + `pnpm lint` clean.
3. New `verify-*.ts` passes against `docker compose up -d`; added to
   `apps/api/package.json` and (for the important ones) the CI verify list in
   `.github/workflows/ci.yml`.
4. Frontend builds (`pnpm --filter @cloud-ops-tool/web build`), oxlint clean,
   endpoints go through `apiClient`, strings through i18n.
5. No cross-module provider imports; external deps behind DI tokens with fakes.
6. `CLAUDE.md`'s "closed seams / still open" list updated to move the item to
   resolved with its verify script named.
7. One focused commit per task with the standard footer; CI green.
