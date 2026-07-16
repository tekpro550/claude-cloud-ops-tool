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

**Still open (per the delivery notes — genuinely not built yet):**
- **Multi-location / multi-region probing** — checks still run from one location.
- **Escalation depth** — SMS, voice, and richer multi-channel escalation routing
  (Slack + webhook exist as channels; the escalation engine doesn't route to them deeply).
- **GCP (and Alibaba/DO) billing ingestion** — cloud coverage is still AWS + Azure.
- **i18n** — user-facing strings are hardcoded English.
- **SSO / SAML** — plus the broader auth-hygiene items (2FA, password reset,
  login rate-limiting, JWT revocation). Note `X-Tenant-Id` header auth remains a
  fallback path; treat the tenant UUID as non-secret until it's removed.
- **Native chat / telephony** channels.

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
