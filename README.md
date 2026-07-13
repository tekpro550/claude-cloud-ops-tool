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
pnpm --filter @cloud-ops-tool/api migration:run
pnpm dev:api   # NestJS backend, http://localhost:3000
pnpm dev:web   # React frontend, http://localhost:5173
```

Sprint 0's Foundation guarantees have standalone verification scripts, runnable against a local
Postgres + Redis (same ones CI uses as service containers):

```bash
pnpm --filter @cloud-ops-tool/api rls:verify            # tenant isolation enforced at the DB layer
pnpm --filter @cloud-ops-tool/api eventbus:verify        # a test event flows end to end through Redis Streams
pnpm --filter @cloud-ops-tool/api notifications:verify   # notification dispatcher, email channel
```

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs on every push/PR to `main`: builds and lints both
apps, runs API unit tests, then spins up real Postgres + Redis service containers to run migrations
and all three verification scripts above — so a broken RLS policy, event bus wiring, or dispatcher
regression fails CI, not just a passing `build`.

## Current status

Sprint 0 (Foundation) is complete, per section 7 of the Module 1 scope document:
project scaffolding, the Foundation Postgres schema with database-layer RLS, the Redis Streams
event bus, the notification dispatcher skeleton (email only), and this CI/CD pipeline with the
four-service modular monolith boundary (Platform, Ticketing, Monitoring, Cost).
