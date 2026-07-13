# Cloud Ops Tool

Unified ticketing, monitoring, and cloud cost (FinOps) platform for Tekpro/MadVR, built as a
multi-tenant SaaS modular monolith. See `docs/` for the full architecture plan and the Module 1
(Foundation + Ticketing) build scope.

## Monorepo layout

```
apps/
  api/     NestJS backend (modular monolith: Ticketing, Monitoring, Cost, Platform services)
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
pnpm dev:api   # NestJS backend, http://localhost:3000
pnpm dev:web   # React frontend, http://localhost:5173
```

## Current status

Sprint 0 (Foundation) is in progress, per section 7 of the Module 1 scope document.
