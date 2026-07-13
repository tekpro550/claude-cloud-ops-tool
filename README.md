# Cloud Ops Tool

Unified ticketing, monitoring, and cloud cost (FinOps) platform for Tekpro/MadVR, built as a
multi-tenant SaaS modular monolith. See `docs/` for the full architecture plan and the Module 1
(Foundation + Ticketing) build scope.

## Monorepo layout

```
apps/
  api/     NestJS backend (modular monolith: apps/api/src/modules/{platform,ticketing,monitoring,cost})
  web/     React + TypeScript frontend (Vite)
packages/
  shared/  Shared TypeScript types used by both apps (tenant, resource, event, notification)
docs/
  Cloud-Ops-Tool-Architecture-Plan.md
  Cloud-Ops-Tool-Module1-Foundation-Ticketing-Scope.md
```

Package manager: `pnpm` (workspaces). Node 20+.

## Getting started

```bash
pnpm install
docker compose up -d          # Postgres + Redis
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
pnpm --filter @cloud-ops-tool/api migration:run
pnpm dev:api   # NestJS backend, http://localhost:3000/api/v1
pnpm dev:web   # React frontend, http://localhost:5173
```

There's no auth yet (Sprint 1 is ticket core, not auth), so the web app has an X-Tenant-Id input
in its header — paste a tenant's id there (e.g. tenant zero's, from the `tenants` table) to load
its tickets. The API's `CORS_ORIGIN` env var must match the web app's origin (defaults to the Vite
dev server's `http://localhost:5173`).

Sprint 0/1's guarantees have standalone verification scripts, runnable against a local Postgres +
Redis (same ones CI uses as service containers):

```bash
pnpm --filter @cloud-ops-tool/api rls:verify              # tenant isolation enforced at the DB layer
pnpm --filter @cloud-ops-tool/api ticketing-rls:verify     # same, for the ticketing tables
pnpm --filter @cloud-ops-tool/api eventbus:verify          # a test event flows end to end through Redis Streams
pnpm --filter @cloud-ops-tool/api notifications:verify     # notification dispatcher, email channel
pnpm --filter @cloud-ops-tool/api tickets-api:verify       # ticket API over real HTTP requests
```

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs on every push/PR to `main`: builds and lints both
apps, runs API unit tests, then spins up real Postgres + Redis service containers to run migrations
and all five verification scripts above — so a broken RLS policy, event bus wiring, dispatcher, or
ticket API regression fails CI, not just a passing `build`.

## Current status

Sprint 0 (Foundation) is complete, per section 7 of the Module 1 scope document: project
scaffolding, the Foundation Postgres schema with database-layer RLS, the Redis Streams event bus,
the notification dispatcher skeleton (email only), and CI/CD with the four-service modular monolith
boundary (Platform, Ticketing, Monitoring, Cost).

Sprint 1 (Ticket core) is in progress: the ticketing data model + RLS + initial agent seed, the
core ticket API, and a minimal ticket list/detail UI are done. Email intake is next.
