# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository. Read this
before making changes; it captures the structure, workflows, and conventions
that aren't obvious from any single file.

## What this is

**Cloud Ops Tool** — a unified **ticketing + monitoring + cloud cost (FinOps)**
platform for Tekpro/MadVR, built as a **multi-tenant SaaS modular monolith**.
The authoritative product/architecture specs live in `docs/`:

- `docs/Cloud-Ops-Tool-Architecture-Plan.md` — overall architecture
- `docs/Cloud-Ops-Tool-Module1-Foundation-Ticketing-Scope.md` — Module 1 (Foundation + Ticketing)
- `docs/Cloud-Ops-Tool-Module2-Monitoring-Scope.md` — Module 2 (Monitoring)
- `docs/Cloud-Ops-Tool-Module3-Cost-FinOps-Scope.md` — Module 3 (Cost/FinOps)
- `docs/deployment-oracle-cloud.md` — production deployment guide

When a change touches behavior a scope doc specifies, treat the doc as the
source of truth and keep code consistent with it.

## Repository layout

Monorepo managed with **pnpm workspaces** (`pnpm-workspace.yaml`), **Node 20+**,
pinned to `pnpm@10.33.0`.

```
apps/
  api/      NestJS 10 backend — the modular monolith (see "API structure")
  web/      React 19 + Vite — internal agent-facing app
  portal/   React 19 + Vite — customer self-service portal
agent/      Go server agent — reports CPU/mem/disk for servers with no external probe
packages/
  shared/   Shared TypeScript types used across apps (@cloud-ops-tool/shared)
docs/       Architecture plan + per-module scope docs + deployment guide
```

Package names: `@cloud-ops-tool/{api,web,portal,shared}`. Run per-package
scripts with `pnpm --filter @cloud-ops-tool/<pkg> <script>`.

### Root scripts (`package.json`)

```bash
pnpm dev:api      # NestJS backend  → http://localhost:3000/api/v1
pnpm dev:web      # agent web app   → http://localhost:5173
pnpm dev:portal   # customer portal → http://localhost:5174
pnpm build        # pnpm -r build   (all packages)
pnpm lint         # pnpm -r lint
pnpm test         # pnpm -r test
```

## Getting started (local dev)

```bash
pnpm install
docker compose up -d                                    # Postgres + Redis
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
pnpm --filter @cloud-ops-tool/api migration:run
pnpm dev:api
pnpm dev:web
```

There's no session/cookie auth in the web app by default — paste a tenant's
UUID into the `X-Tenant-Id` field in the header (e.g. tenant zero's, from the
`tenants` table) to load its data. Logging in (`/auth/login`) swaps to a Bearer
JWT that carries the tenant. The API's `CORS_ORIGIN` must include the web/portal
origins.

## API structure (`apps/api`)

A **NestJS modular monolith** with **four service boundaries** wired in
`src/app.module.ts` (section 4 of the architecture plan):

| Module | Path | Responsibility |
|---|---|---|
| **Platform** | `src/modules/platform` | auth (JWT), tenant/user context, HTTP guards & decorators |
| **Ticketing** | `src/modules/ticketing` | tickets, contacts/companies, SLA, automation, canned responses, portal, email intake, search, migration |
| **Monitoring** | `src/modules/monitoring` | monitors & checks, alerting, escalation, on-call, cloud polling, server agent ingestion |
| **Cost** | `src/modules/cost` | budgets, billing sync, rightsizing, savings, cost dashboards |

Cross-cutting infrastructure lives outside `modules/`:

- `src/database/` — entities, migrations, `data-source.ts`, RLS context, verify scripts
- `src/event-bus/` — Redis Streams event bus (`EventBusService`)
- `src/notifications/` — notification dispatcher + channels (email today)

### Module-boundary discipline (important)

Service boundaries are kept decoupled **on purpose**. A module must NOT import
another feature module's providers to call across the boundary. Instead:

- **Monitoring → Ticketing** goes over an **internal HTTP contract**
  (`POST /internal/tickets/from_alert`, `/internal/tickets/:id/notes`), guarded
  by `InternalApiKeyGuard`. See `AlertEvaluationService`.
- **Cost → Ticketing** uses the same internal HTTP contract, never a direct import.
- The one sanctioned shared provider is `CLOUD_PROVIDER_CLIENT_FACTORY`, which
  `MonitoringModule` **exports** and `CostModule` imports (so cloud client wiring
  isn't duplicated). Follow this pattern; don't add new cross-module imports.

When adding a feature, prefer this same in-process-but-HTTP contract rather than
reaching into another module's services.

## Multi-tenancy & Row-Level Security (the core invariant)

Tenant isolation is enforced by **Postgres RLS**, not by application `WHERE`
clauses. Two database roles:

- **migrator** (`DB_MIGRATOR_USER`) — owns the schema, runs migrations, **bypasses
  RLS**. Used only by the TypeORM CLI (`data-source.ts`) and verify scripts' setup.
- **app_user** (`DB_APP_USER`) — what the running NestJS app connects as. **Bound
  by RLS policies.**

Every RLS-protected query must run through
`withTenantContext(dataSource, tenantId, work)`
(`src/database/context/tenant-context.ts`). It opens a transaction, sets
`app.current_tenant` via `set_config(..., true)` (transaction-scoped, like
`SET LOCAL`), and RLS policies filter on that setting. **Never** hand-roll a
tenant filter as a substitute — the whole point is that isolation holds even if
application code forgets to filter (this is exactly what `rls:verify` and
`ticketing-rls:verify` prove).

### Data access style

Services use **raw parameterized SQL** via `queryRunner.query(sql, params)`,
**not** TypeORM repositories/query builder, even though entities exist. Entities
(`src/database/entities/*.entity.ts`) mainly drive the TypeORM CLI/data-source.
Follow the existing service pattern (see `groups.service.ts` for a clean example):
resolve tenant → `withTenantContext` → parameterized SQL → map Postgres errors
(e.g. `23503` foreign-key → `BadRequestException`) to HTTP exceptions.

## HTTP conventions (backend)

- Global prefix `api/v1`; server listens on `PORT` (default 3000). Set in `main.ts`.
- Global `ValidationPipe` with `{ whitelist: true, transform: true, forbidNonWhitelisted: true }`
  — every request body must be a DTO (`*.dto.ts`) using `class-validator` decorators;
  unknown properties are rejected.
- Guards resolve identity:
  - `TenantHeaderGuard` (Platform) — accepts a valid `kind: 'agent'` Bearer JWT
    (populates `tenantId`/`userId`/`userRole`) **or** falls back to a UUID
    `X-Tenant-Id` header. An invalid/expired token falls through to the header
    rather than hard-rejecting.
  - `PortalAuthGuard` — customer-portal contacts (`kind: 'contact'` JWT).
  - `InternalApiKeyGuard` — `/internal/*` service-to-service (shared secret header).
  - `AgentTokenGuard` — the Go server agent's ingestion endpoints (device JWT).
- Read tenant/user in controllers via the param decorators
  `@CurrentTenantId()` / `@CurrentUser()`, and validate path UUIDs with
  `ParseUUIDPipe`. Return 204 for deletes (`@HttpCode(204)`).

File naming within a module: `<feature>.controller.ts`, `<feature>.service.ts`,
`<feature>.dto.ts`; scheduled background jobs are `*-sweep.service.ts` /
`*-scheduler.service.ts` / `*-poller.service.ts`.

## Database migrations

- TypeORM migrations in `src/database/migrations/`, timestamp-prefixed
  (`<epoch>-<Name>.ts`), applied in filename order. `synchronize` is **off** —
  schema changes happen only through migrations.
- Migrations run as the **migrator** role via `data-source.ts`.
- New tables that hold tenant data must ship their **RLS policy** in the same
  migration (enable RLS + policy keyed on `current_setting('app.current_tenant')`),
  and should be covered by an RLS verify script.

```bash
pnpm --filter @cloud-ops-tool/api migration:run     # apply
pnpm --filter @cloud-ops-tool/api migration:revert  # roll back last
pnpm --filter @cloud-ops-tool/api migration:show    # status
```

## Testing & verification (how correctness is proven)

Two complementary layers:

1. **Jest unit tests** — `*.spec.ts` under `src/` (run with
   `pnpm --filter @cloud-ops-tool/api test`).
2. **Verification scripts** — `src/**/scripts/verify-*.ts`, standalone
   `ts-node` programs that exercise a guarantee **end-to-end against real
   Postgres + Redis** (the same service containers CI uses). Each is exposed as
   a `<name>:verify` pnpm script in `apps/api/package.json`. This is the
   project's primary confidence signal — nearly every feature has one
   (`rls:verify`, `ticketing-rls:verify`, `eventbus:verify`, `tickets-api:verify`,
   `email-intake:verify`, `monitor-engine:verify`, `alerting:verify`,
   `cost-sync:verify`, `rightsizing:verify`, and many more).

**When you add or change a feature, add/update its `verify-*.ts` script** and
keep it runnable against a local `docker compose up -d` stack. Verify scripts
`assert(...)` invariants and print `OK` lines; they exit non-zero on failure so
CI catches regressions. External dependencies (cloud providers) are swapped for
in-memory fakes by overriding DI tokens (e.g. `CLOUD_PROVIDER_CLIENT_FACTORY` in
`verify-cloud-polling.ts`), so no real credentials are needed.

## Linting & formatting

- **API** (`apps/api`): ESLint (`--fix`) + Prettier. Backend TS uses **single
  quotes**. `pnpm --filter @cloud-ops-tool/api lint`.
- **web / portal**: **oxlint** (`.oxlintrc.json`), TypeScript checked via `tsc -b`
  during build. Frontend TS/TSX uses **double quotes**.

Match the surrounding file's quote/format style; CI runs the same lint commands.

## Frontend conventions (`apps/web`, `apps/portal`)

- React 19 + `react-router-dom` v7, Vite, **no external state-management library**
  (local state + context: `lib/auth.tsx`, `lib/tenant.tsx`).
- All backend calls go through a typed API-client module (`src/lib/apiClient.ts`,
  plus `costApiClient.ts` / `monitoringApiClient.ts` in web). The core helper is
  `request<T>(tenantId, method, path, body?)`, which attaches `X-Tenant-Id` and,
  when set via `setAuthToken`, `Authorization: Bearer`. Add new endpoints as
  thin functions there rather than calling `fetch` inline (multipart upload /
  blob download are the documented exceptions).
- Pages in `src/pages/`, reusable pieces in `src/components/` (admin CRUD screens
  under `components/admin/`), shared response shapes in `src/types/`.
- `VITE_API_BASE_URL` (default `http://localhost:3000/api/v1`) points the client
  at the API.

## Background jobs / schedulers

Long-running in-process jobs (intervals configured by env vars):

- `MonitorSchedulerService` — polls due http/ping/port/dns/ssl checks (`MONITOR_SCHEDULER_INTERVAL_MS`)
- `CloudResourcePollerService` — polls AWS/Azure metrics
- `OverdueSweepService` — SLA breach sweep (`SLA_SWEEP_INTERVAL_MS`)
- `EscalationSweepService`, `TimeAutomationSweepService`, `RightsizingSweepService`,
  `CostSavingsSweepService`, `CostPaceCheckService` — periodic sweeps
- `EmailIntakeService` — IMAP mailbox → tickets (`EMAIL_INTAKE_ENABLED`, off by default)

## Configuration

`apps/api/.env.example` is the reference for every backend env var (DB roles,
Redis, SMTP/`EMAIL_TRANSPORT`, IMAP intake, JWT secret, `INTERNAL_API_KEY`,
sweep intervals, OAuth, Freshdesk migration). Secrets are dev-only placeholders —
generate real values before any real deployment. Do **not** commit real
credentials; `.env` / `.env.local` are gitignored.

## CI/CD

`.github/workflows/ci.yml` runs on every push to `main` and every PR, in two jobs:

- **api**: spins up Postgres 16 + Redis 7 service containers, then
  `build` → `eslint` → `jest` → `migration:run` → the Sprint 0/1 verify scripts
  (RLS ×2, event bus, notifications, tickets API, email intake). A broken RLS
  policy, event wiring, dispatcher, ticket API, or intake regression fails CI —
  not just a failing compile.
- **web**: `oxlint` + `vite build`.

Before pushing, locally run at minimum the API build, lint, and the verify
scripts relevant to your change against a `docker compose up -d` stack.

### Pre-push hook

A tracked pre-push hook (`.githooks/pre-push`) runs `pnpm preflight` — the two
checks that gate CI before anything else: the frozen-lockfile sync check
(`pnpm install --frozen-lockfile`) and lint (eslint on api, oxlint on
web/portal). Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

It's fast (no build/test) and skips silently if pnpm isn't installed. If a
push is blocked by a lockfile mismatch, run `pnpm install` to regenerate
`pnpm-lock.yaml` and commit it. `pnpm preflight` can also be run by hand.

## Production deployment

`docker-compose.prod.yml` + `.env.prod.example` run the full stack (Postgres,
Redis, API, agent web app, customer portal) behind **Caddy** (automatic HTTPS).
`docs/deployment-oracle-cloud.md` is the step-by-step guide (incl. Oracle Cloud VM).
Per-app `Dockerfile`s live in each `apps/*` directory.

## The Go server agent (`agent/`)

A small dependency-free Go binary that reports CPU/mem/disk to the API on an
interval for hosts with no external probe (Module 2 Sprint 3). Auth is a
long-lived device JWT from `POST /agent-tokens`. Metrics come from `/proc` on
Linux (`metrics_linux.go`; `metrics_other.go` is the non-Linux stub). See
`agent/README.md`. Build with `cd agent && go build -o cloud-ops-agent .`.

## Current state: closed seams & what's still open

The first version of this file listed several deliberate stand-ins (unenforced
RBAC, plaintext credentials, an open reply-email loop, ignored business hours,
etc.). A subsequent fix pass (~15 commits) closed almost all of them; the status
below is **verified against the code now in `main`**, not just commit messages.

**Resolved:**
- **Outbound reply email loop is closed.** `TicketsService.addMessage` now
  dispatches the reply (sanitized HTML) to the contact and to ticket watchers
  after commit, via `NotificationsService` — plus agent assignment/reply
  notifications and canned-response placeholders.
- **RBAC is enforced.** New `RolesGuard` + `@Roles(...)` decorator
  (`modules/platform/http/`) gate admin-only routes (agents, ticket types,
  custom fields, cloud credentials, agent tokens, cost settings, business-hours
  settings, audit log). `userRole` from the JWT is now actually read.
- **Cloud credentials are encrypted at rest.** Stored in `config_encrypted` via
  pgcrypto `pgp_sym_encrypt`/`pgp_sym_decrypt` (`credentials-crypto.ts`,
  `EncryptCloudCredentials` migration) — no longer plaintext jsonb, still never
  returned by the API.
- **Business hours are honored.** `calculate-due-dates.ts` applies a tenant
  business-hours window when a policy is `business_hours_only` and hours are
  configured (`AddTenantBusinessHours` schema), falling back to 24/7 otherwise.
- **Alert notification channels beyond email.** Slack + webhook channels added
  (`AddSlackWebhookNotificationChannels`); the dispatcher is no longer wired only
  to the SLA sweep.
- **Ticket tags + tag-based cost allocation.** `AddTicketTags` and
  `AddCostLineItemTags` schema, a `cost-allocation` module (showback/chargeback),
  plus custom fields, ticket merge, parent/child links, watchers, an **admin
  audit log**, ticketing analytics/reporting, cost anomaly detection, disk-full
  forecast alerts, and AI-assist (thread summarize + suggested reply).
- **Multi-location / multi-region probing.** `AddMultiLocationProbing` records a
  per-check `location` (from `PROBE_LOCATION`) and a per-monitor
  `min_failing_locations`; `AlertEvaluationService` only fires once a quorum of
  distinct locations report failing, suppressing single-vantage false positives
  (`verify-multi-location.ts`).
- **Escalation depth — SMS + voice.** `AddSmsNotificationChannel`, plus
  `SmsChannel`/`VoiceChannel` (Twilio REST via `fetch`, `SMS_TRANSPORT` /
  `VOICE_TRANSPORT` defaulting to `log`); the dispatcher registers them alongside
  email/Slack/webhook (`verify-notification-channels.ts`).
- **GCP / DigitalOcean / Alibaba / Oracle billing.** `AddCloudProviders` extends
  the provider enum; `cloud/extra-provider-clients.ts` adds real billing fetches
  for GCP + DigitalOcean and honest empty-scaffold clients for Alibaba + Oracle,
  wired through the `CLOUD_PROVIDER_CLIENT_FACTORY`
  (`verify-cloud-billing-providers.ts`).
- **i18n.** `lib/i18n.tsx` (`I18nProvider` + `useTranslation`, en/es dictionaries,
  `localStorage` locale, header language switcher); nav/auth/search strings run
  through `t()`.
- **Auth hardening.** Password reset (single-use hashed tokens + email),
  login rate-limiting, JWT revocation (`auth-security.ts`, Redis), **2FA/TOTP**
  (native RFC 6238; encrypted secret; `MfaService`; login demands the code),
  and **OIDC single sign-on** (`tenant_sso_configs`, `SsoService` with signed
  state + JIT provisioning behind an injectable OIDC client)
  (`verify-auth-hygiene.ts`, `verify-auth-mfa-sso.ts`).
- **Native chat.** `CreateChat` (chat_sessions + chat_messages, RLS-scoped),
  `ChatService`/`ChatController` (`@Controller('chat')`) with agent-claim /
  visitor-reopen semantics and `?since=` delta polling; web `ChatPage` console
  (`verify-chat.ts`).
- **Auto-assignment strategies (competitive-parity plan, task 1).**
  `AddAssignmentStrategies` adds `groups.assignment_strategy`
  (manual/round_robin/load_based/skill_based) + `max_open_tickets_per_agent`,
  `agent_skills`, `group_assignment_cursor`, and `tickets.required_skill`.
  `AssignmentService.pickAssignee` (a static helper taking the caller's
  `QueryRunner`, same pattern as `CustomFieldsService.loadDefs`) resolves the
  next assignee inside `TicketsService.create`'s transaction; an explicit
  `agentId` always wins. Admin UI: assignment-strategy picker on Groups, new
  Agent skills card (`verify-assignment.ts`).
- **Public status pages (competitive-parity plan, task 2).**
  `CreateStatusPages` adds `status_pages` + `status_page_monitors` (RLS), plus
  one deliberate, narrowly-scoped widening: a second PERMISSIVE SELECT policy
  on `status_pages` gated on `is_public = true AND
  current_setting('app.public_status_read', true) = 'true'` -- that second
  transaction-local flag (SET LOCAL, same as `app.current_tenant`) is what
  keeps a tenant's public pages from leaking into every *other* tenant's own
  admin list, which the first draft of this policy got wrong and
  `verify-status-pages.ts` caught. `StatusPagesService.getPublicStatus`
  resolves slug → tenant_id with that flag set, then re-enters normal
  `withTenantContext` to load monitors and return only whitelisted display
  fields (name/status/90-day uptime %) -- never tenant_id or monitor
  internals. `StatusPagePublicController` (`GET /public/status/:slug`) has NO
  guard at all. The web route `/status/:slug` renders standalone, without the
  admin header/nav chrome (`App.tsx`'s `isPublicStatusRoute` check).
- **Metric-threshold + anomaly alert rules (competitive-parity plan, task 3).**
  `ExtendAlertRules` adds `rule_kind` (status/threshold/anomaly, default
  `status` — every existing row keeps its exact original behavior) plus
  `metric`/`comparator`/`threshold`/`for_consecutive`/`anomaly_sensitivity` to
  `alert_rules` (still one row per monitor). `metric-alert-rule.ts` is a small
  allowlist (`METRICS`, mirroring the report builder's allowlist approach) of
  SQL expressions pulling a metric out of `monitor_checks` (a real column for
  `response_time_ms`, `raw_output->>'…'` for agent/cloud metrics) plus a pure
  `detectMetricAnomaly` (mean/stddev/z-score, same shape as
  `cost/cost-anomaly-detect.ts`). `AlertEvaluationService.applyToDatabase` now
  dispatches on `rule_kind`: threshold fires once the last `for_consecutive`
  samples all satisfy the comparator; anomaly fires once they all deviate
  from a trailing baseline by `anomaly_sensitivity` standard deviations
  (baseline excludes the samples being judged). Everything downstream —
  open/repeat/resolve/dedupe, ticket linking — is unchanged and shared with
  the status path (`verify-metric-alert-rules.ts`, plus `alerting:verify` and
  `multi-location:verify` re-run clean as regressions).
- **RI/Savings-Plan recommendations + coverage/utilization (competitive-parity
  plan, task 4).** `CreateCommitments` adds `commitments` (owned purchases) and
  `commitment_recommendations` (RLS-scoped), scoped to
  `(cloud_credential_id, service, region)` -- `cost_line_items` has no
  per-instance-family granularity (documented limitation, same one
  `cost-savings-estimate.ts` already discloses). `commitment-recommend.ts`
  recommends the 20th-percentile trailing daily spend as the commitment level
  (a stable floor, not the average/max) with disclosed 1-year discount rates
  (RI ~35%, Savings Plan ~27%) and a partial-upfront break-even model;
  `commitment-coverage.ts` computes coverage % (of spend) and utilization %
  (of commitment) + wasted $ from zero-filled daily spend arrays, both pure
  and unit-tested directly. `CommitmentSweepService` mirrors
  `RightsizingSweepService`'s idempotent per-scope upsert. Web: a
  `/cost/commitments` page (recommendations, owned commitments with live
  coverage/utilization, a record-commitment form) (`verify-commitments.ts`,
  14 checks incl. cross-tenant credential rejection and RLS isolation;
  `rightsizing:verify`/`cost-allocation:verify` re-run clean as regressions).
- **Richer forecasting (competitive-parity plan, task 5).** `forecast.ts`
  (pure) adds two forecasts beyond `cost-pace.ts`'s flat linear projection:
  `forecastMonthEnd` buckets elapsed days by weekday and projects each
  remaining calendar day at its own weekday's average rate (falls back to a
  flat rate under a week of data), and `forecastMultiMonth` fits an
  ordinary-least-squares trend across trailing monthly totals and projects it
  forward. Both report a confidence band from residual variance, disclosed as
  a simplification. `CostDashboardService.forecast()` (`GET
  /cost/dashboard/forecast`, optional `cloudCredentialId`/`horizonMonths`)
  wires real `cost_line_items` data through both; reuses
  `commitments/commitment-coverage.ts`'s `buildDailySpend` zero-fill helper.
  Web: a Forecast panel on the cost dashboard (projected month-end + range,
  trend rate, multi-month table) (`verify-cost-forecast.ts`, 13 checks incl.
  a synthetic case proving the weekday-weighted method beats a naive flat-rate
  projection; `cost-pace:verify`/`cost-anomaly:verify` re-run clean as
  regressions).
- **Scheduled + exported reports (competitive-parity plan, task 6).**
  `CreateScheduledReports` adds `scheduled_reports` (RLS-scoped; `report_kind`
  is an open CHECK list so a later report source can extend it without
  reshaping the table). `ReportGeneratorService` turns a `report_kind` into a
  `ReportTable` by reusing the same tested services the dashboards call
  (`CostDashboardService`, `CostAllocationService`, `CommitmentsService`) --
  cost_dashboard, cost_by_service, cost_by_tag, commitment_coverage. Cost
  module only for now; a ticket-sourced kind (report builder, task 7) would
  need the internal HTTP contract like every other cross-module call here,
  documented on the generator and the migration. `report-export.ts` (pure)
  serializes to RFC 4180 CSV or a simple pdfkit-rendered PDF (pure-JS, no
  Chromium dependency -- `pdfkit`/`@types/pdfkit` added).
  `ScheduledReportSweepService` finds due reports, renders, and emails each
  recipient via the normal `NotificationsService.enqueue` → event-bus →
  `NotificationDispatcherService` path, then advances `next_run_at` per
  cadence (`report-schedule.ts`, pure). Email attachments are new plumbing:
  `NotificationAttachment` (base64 in the notification's jsonb `payload`,
  not a new column) flows through `SendInput.attachment` into
  `EmailChannel.send`'s nodemailer call. Admin-only
  `POST /cost/scheduled-reports/:id/run-now` streams the rendered file for
  immediate download, independent of the schedule
  (`verify-scheduled-reports.ts`, 18 checks incl. the attachment actually
  being sent through the real dispatch pipeline, not a mock;
  `notifications:verify`/`notification-channels:verify`/`slack-webhook:verify`
  re-run clean as regressions). Web: a Scheduled reports admin card
  (create/run-now/delete); `run-now` downloads via a blob fetch, the
  documented apiClient exception for non-JSON responses.
- **Custom report builder (competitive-parity plan, task 7).**
  `CreateReportDefinitions` adds `report_definitions` (RLS-scoped; one jsonb
  `config` column -- the shape is owned by `report-builder.ts`'s allowlist,
  not the schema). `report-builder.ts` is a pure, security-critical
  allowlist query builder: every metric (`ticket_count`,
  `avg_first_response_minutes`, `avg_resolution_minutes`,
  `sla_attainment_pct`, `avg_csat` -- same happy=1/neutral=0.5/unhappy=0
  weighting as `reports.service.ts`'s `csat()`), group-by dimension
  (status/priority/ticket_type_id/group_id/assignee_id/source/day/week/month),
  and filter field the caller can name is a token that must exist in a fixed
  `Record<Token, string>` map; the SQL fragment it maps to is fixed at
  compile time, every value is a bind parameter, and an unrecognized token
  throws `BadRequestException` before any query runs -- not application-layer
  sanitization, the rejection itself is what keeps this off being a SQL
  injection surface. `ReportDefinitionsService` (CRUD + `preview()` for an
  unsaved config + `run()` for a saved one, both executing the same
  `buildReportQuery()` path) sits behind `ReportDefinitionsController`
  (`@Controller('reports/custom')`, `TenantHeaderGuard`, same as the existing
  `ReportsController`). Web: a "Custom report builder" section on the Reports
  page (`CustomReportBuilder.tsx`) -- metric/group-by/filter pickers, a
  preview table, save-as-named-definition, and a saved-reports list with
  run/delete (`verify-report-builder.ts`, 12 checks incl. hand-counted
  ticket_count-by-status, a month-bucketed avg_resolution_minutes, a filter
  narrowing results, three separate out-of-allowlist rejections that leave
  the `tickets` table intact, and a saved definition re-running identically
  to its original preview; `reports:verify` re-runs clean as a regression).
- **Synthetic browser / transaction monitoring (competitive-parity plan, task
  8).** `AddSyntheticMonitors` widens `monitor_type_enum` with `'synthetic'`
  and adds `synthetic_run_steps` (RLS-scoped; one row per step of a run,
  `monitor_check_id` FK back to the `monitor_checks` row that run produced)
  -- the per-step timing data a waterfall UI needs that `monitor_checks`
  alone can't hold. `monitoring/synthetic/synthetic-script.ts` is a pure
  allowlist validator (same reject-before-save contract as
  `reports/report-builder.ts`): a monitor's `config.steps` must each name an
  allowlisted action (`goto`/`click`/`fill`/`expectText`) with the right
  shape for that action, or `MonitorsService.create`/`update` throws
  `BadRequestException` before saving. `SYNTHETIC_RUNNER` (a `Symbol` DI
  token, same pattern as `CLOUD_PROVIDER_CLIENT_FACTORY`) abstracts *running*
  a script; `PlaywrightSyntheticRunner` is the real implementation (headless
  Chromium via the `playwright` package, now an `apps/api` dependency --
  Chromium itself was already pre-installed in this environment). A new
  `SyntheticSchedulerService` (mirrors `MonitorSchedulerService`'s
  per-tenant-transaction-plus-timer shape, but its own timer/interval since
  `'synthetic'` isn't in `MonitorSchedulerService`'s actively-polled types)
  polls due synthetic monitors, runs the script, writes the usual
  `monitor_checks` row (status up/down, `response_time_ms` = total run time)
  plus one `synthetic_run_steps` row per step, and feeds the result through
  the existing `AlertEvaluationService.evaluate()` -- a synthetic monitor
  alerts exactly like an http/ping one. Web: a script builder (add/remove
  step rows, per-action fields, `maxStepMs`) on the resource dashboard's
  "add monitor" form, and a `SyntheticWaterfall` component rendering each
  monitor's last run as per-step timing bars with the failing step called
  out in red (`verify-synthetic.ts`, 15 checks against a **fake**
  `SYNTHETIC_RUNNER` -- no real browser in CI -- incl. a passing run writing
  "up" plus 4 step rows, a failing step writing "down" with the error on the
  right step index, a step exceeding `maxStepMs` marking the run down via
  the same timeout path the real runner's `withTimeout` would hit, and two
  consecutive failures opening a real alert through the unmodified alerting
  pipeline; `monitor-engine:verify`/`alerting:verify`/`multi-location:verify`
  re-run clean as regressions).
- **Log management (competitive-parity plan, task 9).** `CreateLogManagement`
  adds `log_sources`, `log_entries` (indexed on `(tenant_id, log_source_id, ts
  DESC)` plus a GIN index on `to_tsvector('english', message)` for search),
  and `log_alert_rules` (all RLS-scoped). `log_sources` deliberately has no
  `token_hash` column despite the plan text -- the ingest credential is a
  self-describing signed JWT (`kind: 'log_source'`, `jwt.ts`), the same
  pattern `agent_tokens`/`AgentTokenGuard` already use, so
  `LogSourceTokenGuard` resolves `tenantId` from the token itself instead of
  needing an RLS-gated cross-tenant lookup before the tenant is even known.
  `log_alert_rules.escalation_policy_id` is schema-only for now (same
  "column exists for later wiring" precedent as
  `AddContactAuthAndSourceDetail`'s `password_hash`/`oauth_provider`) --
  `LogAlertSweepService` always fires by opening a ticket via the internal
  `/internal/tickets/from_alert` contract (ticket priority derived from
  `level_at_least`), the simpler of the two options the plan allows, not by
  walking the policy's steps. `LogIngestionController`
  (`POST /logs/ingest`, `LogSourceTokenGuard`) mirrors
  `AgentIngestionController` structurally; `LogsController` (`TenantHeaderGuard`)
  covers search (`plainto_tsquery` over the FTS index, plus source_id/level/
  time-range filters) and source + alert-rule CRUD, all via `LogsService`.
  `LogAlertSweepService` mirrors `EscalationSweepService`'s timer shape:
  for each enabled rule whose `window_seconds` have elapsed since
  `last_fired_at` (debounce), counts matching `log_entries` (level >=
  `level_at_least`, optional `match_query` full-text match) in the trailing
  window and fires once `threshold` is crossed. Web: a `/monitoring/logs`
  `LogsPage` (source/level filters, full-text search box, a flat
  timestamp/level/message list with level-tinted rows), plus `LogSourcesAdmin`
  (create a source, see its ingest token exactly once, disable/delete) and
  `LogAlertRulesAdmin` admin cards (`verify-logs.ts`, 18 checks incl. a
  disabled source's token being rejected, full-text search matching by
  keyword, level and time-range filters, RLS hiding one tenant's logs/sources
  from another, a rule not firing below threshold then firing and opening a
  ticket once it's crossed, and the fire being debounced on the very next
  sweep; `monitor-engine:verify`/`alerting:verify`/`synthetic:verify`/
  `auth:verify` re-run clean as regressions).
- **APM + RUM ingestion (competitive-parity plan, task 10).** `CreateApmRum`
  adds `apm_ingest_keys`/`apm_traces`/`apm_spans` and
  `rum_app_keys`/`rum_events` (all RLS-scoped) -- ingestion + storage +
  aggregation only, deliberately **not** a language-specific
  auto-instrumentation agent, distributed trace-context propagation, or
  sampling controls (see `docs/apm-rum-integration.md`, which ships instead
  a copy-paste Express middleware and browser beacon snippet).
  `apm_ingest_keys`/`rum_app_keys` follow `log_sources`' no-token-hash-column
  precedent (self-describing signed JWTs, `kind: 'apm_ingest'` /
  `'rum_app'`). `apm_spans.parent_span_id` has no FK -- a trace's spans
  arrive with client-assigned `spanId`s unique only within that trace;
  `ApmService.ingestTraces` resolves them to real uuids in one pass before
  any insert (`crypto.randomUUID()`), so a child can reference a parent
  that's about to be inserted in the same transaction without a two-pass or
  deferred-constraint dance. `apm-percentile.ts` is a small pure module
  (nearest-rank percentiles + the standard Apdex formula
  `(satisfied + tolerating/2) / total`, T defaults to 500ms) reused by both
  `ApmService.serviceStats` (per-transaction p50/p95/p99/apdex/error-rate)
  and `RumService.pageStats` (per-page LCP/FCP/TTFB percentiles + JS-error
  rate, with a disclosed simplification: there's no dedicated "page view"
  event, so the error-rate denominator is the max sample count across the
  three timing metrics). RUM's `POST /rum/collect` is the one deliberate
  CORS-widening exception in the app -- RUM beacons come from arbitrary
  customer websites, not the agent app or portal, so `main.ts` answers that
  one path's CORS (incl. the OPTIONS preflight) with `Access-Control-Allow-
  Origin: *` via middleware registered before the global `cors()`
  middleware, same "narrowly-scoped, disclosed" spirit as status-pages' RLS
  widening; tenant scoping for that route comes entirely from the signed
  `appKey` in the request body (verified in `RumService.collect`), not from
  origin, so the open CORS policy doesn't widen who can write data, only who
  can attempt to. Web: an APM dashboard (`/monitoring/apm` -- service picker,
  apdex/percentile stat tiles, a per-transaction table, slowest traces, and
  an `ApmSpanWaterfall` reconstructing the span tree from `parent_span_id`)
  and a RUM dashboard (`/monitoring/rum` -- page picker, LCP/FCP/TTFB
  percentile tiles, JS error rate), plus `ApmIngestKeysAdmin`/
  `RumAppKeysAdmin` admin cards (`verify-apm-rum.ts`, 22 checks incl.
  hand-computed p50/p95/avg/apdex/error-rate over 10 traces, a 3-level span
  tree reconstructing correctly by parent id, a removed ingest key's token
  being rejected, an invalid RUM app key being rejected, hand-computed RUM
  percentiles + error rate, and RLS isolation for both APM and RUM;
  `monitor-engine:verify`/`logs:verify`/`synthetic:verify`/`alerting:verify`/
  `auth:verify`/`status-pages:verify` re-run clean as regressions). All three
  token-authed ingest paths (`/apm/traces`, `/rum/collect`, `/logs/ingest`)
  share a Redis fixed-window rate limiter (`ingest-rate-limit.ts`, keyed per
  ingest key/source, fail-open on a Redis outage, `INGEST_MAX_REQUESTS_PER_
  WINDOW`/`INGEST_RATE_WINDOW_SECONDS`) and an `@ArrayMaxSize(1000)` batch cap;
  ingest `ts` fields validate as `@IsDateString()` so a malformed timestamp
  is a 400, not a Postgres cast 500. `serviceStats`/`pageStats` default to a
  trailing 24h window when the caller doesn't bound it, so the in-Node
  percentile aggregation never scans the full history unbounded.
- **SNMP / network monitoring (competitive-parity plan, task 11).**
  `CreateNetworkMonitoring` adds `network_devices` and
  `network_interface_samples` (both RLS-scoped). `network_devices` follows
  `cloud_credentials`' encryption pattern exactly -- `community_encrypted`
  via pgcrypto `pgp_sym_encrypt`/`pgp_sym_decrypt` with the same
  `CREDENTIALS_ENCRYPTION_KEY` (`credentials-crypto.ts`, no new key), and
  `NetworkDevicesService`'s `SAFE_COLUMNS` never selects it -- the community
  string is never returned by the API, same as a cloud credential's config.
  `SNMP_CLIENT` (a `Symbol` DI token, same pattern as
  `CLOUD_PROVIDER_CLIENT_FACTORY`/`SYNTHETIC_RUNNER`) abstracts walking a
  device's IF-MIB `ifTable`; `NetSnmpClient` is the real implementation
  (`net-snmp`, now an `apps/api` dependency, GET/WALKs `ifDescr`/
  `ifOperStatus`/`ifInOctets`/`ifOutOctets`). `NetworkPollerService` mirrors
  `CloudResourcePollerService`'s per-tenant-transaction-plus-timer shape but
  deliberately doesn't route through monitors/monitor_checks/
  `AlertEvaluationService` the way `cloud_metric` monitors do -- an
  interface is auto-discovered by walking the ifTable, not something a
  tenant explicitly provisions a monitor for, so an up→down *transition*
  (not "is currently down", which would re-fire every poll while it stays
  down) opens a ticket directly via the internal contract, the same simpler
  pattern `LogAlertSweepService` uses for a log-alert breach. Throughput
  (`network-throughput.ts`, pure) is delta-octets/delta-time computed from
  consecutive samples at read time, not stored -- a documented limitation
  for 32-bit (non-`ifHC*`) counter wraparound reports "unknown" rather than
  a negative rate. Web: `NetworkDevicesAdmin` (create a device, community
  string write-only, delete) and a `/monitoring/network` dashboard (device
  picker → interface table with status badges + a `NetworkThroughputSparkline`
  per interface) (`verify-network.ts`, 15 checks incl. the community string
  round-tripping through encryption and never being returned by the API,
  hand-computed throughput from two consecutive polls, an up→down
  transition opening exactly one ticket while staying down opens no second
  one, and RLS isolation; `monitor-engine:verify`/`alerting:verify`/
  `logs:verify`/`apm-rum:verify`/`synthetic:verify`/`auth:verify`/
  `credentials-encryption:verify`/`rbac:verify`/`status-pages:verify`
  re-run clean as regressions).

All 11 tasks of the competitive-parity plan (`docs/implementation-plan-competitive-parity.md`)
are now complete.

- **All 11 AI value-add features (AI plan, Tasks 0–11).** `src/ai/` is now a
  `@Global()` `AiModule` that provides `AI_COMPLETION_CLIENT` and
  `TenantAiSettingsService` to every module without cross-module imports.
  Features delivered across all three modules:
  - **Task 1 (M1): Ticket auto-triage.** `TicketTriageService` fires on
    `TicketsService.create` (fire-and-forget). AI suggests priority/type/tags/skill
    from tenant allowlists; `auto_triage_mode=apply` auto-applies them. Table
    `ticket_ai_triage` stores each suggestion with `applied` flag.
    (`verify-ai-triage.ts`)
  - **Task 2 (M3): Cost spike narrative.** `CostNarrativeService` caches AI
    narratives by `sha256(input_hash)` in `cost_narratives`. Endpoint
    `GET /cost/anomalies/narrative`. (`verify-cost-narrative.ts`)
  - **Task 3 (M1): Ticket sentiment detection.** `TicketSentimentService` fires
    on every inbound customer message (fire-and-forget, 5-min debounce). Stores
    `sentiment` + `sentiment_score` on `tickets`. Allowlist gates the four
    labels (`positive/neutral/negative/at_risk`). (`verify-ticket-sentiment.ts`)
  - **Task 4 (M3): Rightsizing rationale.** `RightsizingRationaleService` fires
    after each `RightsizingSweepService` upsert. Fills `ai_rationale` on
    `rightsizing_recommendations`. (`verify-rightsizing-rationale.ts`)
  - **Task 5 (M2): Alert RCA narrative.** `AlertNarrativeService` fires on alert
    creation from `AlertEvaluationService`. Loads last N `monitor_checks`, calls
    AI, stores `narrative` on `alerts`. (`verify-alert-narrative.ts`)
  - **Task 6 (M2): Natural-language log search.** `LogNlSearchService` at
    `POST /logs/search/nl`. AI parses a plain-English query into structured
    `{q?,level?,sourceName?,fromRelative?,to?}`, validated against allowlists,
    then delegates to `LogsService.search`. (`verify-log-nl-search.ts`)
  - **Task 7 (M1): Similar ticket detection.** `TicketSimilarService` uses
    `pg_trgm` for candidates, AI re-ranks. Table `ticket_similar_suggestions`.
    `GET /tickets/:id/similar`. (`verify-ticket-similar.ts`)
  - **Task 8 (M2): Synthetic script generation.** `SyntheticScriptGenService` at
    `POST /synthetic/generate`. AI drafts a step list; `validateSyntheticScript()`
    is the allowlist gate before returning. (`verify-synthetic-script-gen.ts`)
  - **Task 9 (M3): AI executive summary in scheduled reports.**
    `ReportGeneratorService.generate(…, includeAiSummary=true)` appends a 2-4
    sentence AI narrative to the `ReportTable.aiSummary` field. `scheduled_reports`
    gains `include_ai_summary boolean`. AI failure is fire-and-forget; the report
    still delivers. (`verify-report-ai-summary.ts`)
  - **Task 10 (M1): KB article mining.** `KbMiningService` clusters resolved
    tickets by `pg_trgm` subject similarity (`suggestClusters`) and drafts KB
    articles from ticket digests (`draftArticle`). Table `kb_articles`
    (draft/published/archived). `KbMiningController` at `/kb-articles`.
    (`verify-kb-mining.ts`)
  - **Task 11 (all): Unified "Ask" assistant.** `AskService` at `POST /ask`.
    Session-based (tables `ask_sessions` + `ask_messages`), prompt-driven
    tool-use loop (≤`MAX_TOOL_ROUNDS` = 6 rounds), fixed tool catalog:
    `search_tickets`, `list_alerts`, `get_cost_summary`, `search_logs`,
    `list_monitors` (see `ai/ask/ask-tools.ts`). Each tool is an allowlisted
    GET to the app's own REST API carrying `X-Tenant-Id`, so reads ride the
    normal guard/RLS stack rather than importing another module's services.
    (`verify-ask.ts`)

- **AI value-add wave 2 (audit follow-on, 4 features).**
  - **Cross-signal alert RCA (M2).** `AlertNarrativeService` now assembles
    correlated evidence from the same ±`CORRELATION_WINDOW_MINUTES` window —
    error/warn `log_entries` and APM error-rate movement (`apm_traces`,
    window vs. preceding baseline) — into the RCA prompt alongside the
    monitor checks. Correlation is by time window, not topology (log/APM
    sources aren't linked to resources in the schema), disclosed in the
    prompt. (`verify-alert-narrative.ts` extended.)
  - **NL automation-rule builder (M1).** `AutomationRuleGenService` at
    `POST /automation-rules/generate` drafts a rule from plain English;
    output is gated against the exact allowlists `CreateAutomationRuleDto`
    enforces (TRIGGERS/CONDITION_FIELDS/CONDITION_OPERATORS/ACTION_TYPES,
    now exported from the DTO) and returned as a review draft — saving still
    goes through the normal `POST /automation-rules` + ValidationPipe.
    (`verify-automation-rule-gen.ts`, DB-free.)
  - **NL custom reports (M1).** `ReportNlService` at `POST /reports/custom/nl`
    maps a plain-English question to a `ReportConfig`, then **re-validates it
    by running `buildReportQuery()`** — the same allowlist gate the saved
    path uses is the security boundary, so a hallucinated metric/dimension/
    filter token throws before any SQL runs. (`verify-report-nl.ts`, DB-free.)
  - **Chat AI first-responder + KB deflection (all).**
    `AddChatAiAndKbSearch` migration adds an `'ai'` chat author type,
    `chat_sessions.ai_enabled` (the off switch), and pg_trgm GIN indexes on
    `kb_articles`. `KbSearchService` searches **published** articles
    (pg_trgm candidates + optional AI re-rank, graceful-degradation shape
    like `TicketSimilarService`), exposed at `GET /kb-articles/search`
    (agents) and `GET /portal/kb/search` (portal deflection, pre-submit,
    `TenantHeaderGuard`). `ChatAiResponderService` fires fire-and-forget from
    `ChatService.addMessage` on a visitor turn: it answers grounded in KB
    excerpts **only while the session is open, `ai_enabled`, and unclaimed**
    — the moment a human agent replies (`assigned_agent_id` set) it goes
    silent (the handoff), re-checked atomically inside the insert so a
    late-arriving agent always wins. (`verify-chat-ai.ts`.)

**Still open (genuinely not built yet):**
- **SAML SSO** — OIDC SSO ships; full SAML (XML signature validation) is the
  remaining SSO protocol. Note `X-Tenant-Id` header auth also remains a fallback
  path; treat the tenant UUID as non-secret until it's removed.
- **Telephony / native voice + video chat** — SMS and voice *notifications*
  exist (Twilio), and text chat ships, but there's no inbound telephony or
  real-time voice/video channel.
- **Deeper escalation routing** — SMS/voice are available as channels, but the
  escalation engine's multi-step routing across them is still shallow.

When you close one of the remaining items, update this list and add/extend the
relevant `verify-*.ts` script.

## Conventions checklist for changes

- Tenant data access → always `withTenantContext` + parameterized SQL; never a
  manual tenant filter as the isolation mechanism.
- New tenant table → migration includes RLS enable + policy; add/extend a verify script.
- Cross-module calls → internal HTTP contract, not direct module imports.
- New request body → a `class-validator` DTO (global ValidationPipe rejects extras).
- New endpoint → add a typed function to the frontend `apiClient`, not inline fetch.
- New/changed behavior → add or update the feature's `verify-*.ts` and keep CI green.
- Follow existing file naming and per-app quote style (single in api, double in web/portal).
</content>
</invoke>
