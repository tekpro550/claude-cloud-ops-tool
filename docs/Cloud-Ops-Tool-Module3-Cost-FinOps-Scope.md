# Cloud Ops Tool
## Module 3 Build Scope: Cost / FinOps
### Data models, API contracts, and sprint plan

Companion document to Cloud-Ops-Tool-Architecture-Plan.md, in the same style as
Cloud-Ops-Tool-Module1-Foundation-Ticketing-Scope.md and
Cloud-Ops-Tool-Module2-Monitoring-Scope.md. Like Module 2's scope doc, none of this has been
confirmed with you yet — section 8 lays out what needs a decision before build starts. Nothing here
is committed.

---

## 1. Scope Boundary

This module covers billing data ingestion from AWS Cost Explorer and Azure Cost Management, the MSP
multi-account rollup dashboard, month-to-date pace alerting, rightsizing/idle recommendations that
reference live monitoring data, and the "resolve as rightsized -> log the saving -> track whether it
materialized" loop that is architecture plan section 3's second differentiator. It is explicitly the
module the architecture plan (section 4, section 7.3 sprint-order note in the Module 2 doc's own
section 7) says depends on Module 2 being live first: rightsizing recommendations only work because
`monitor_checks` already has real CPU/memory/disk utilization data to read.

Per the architecture plan's Phase 1 scope (section 9) and section 7.3's own Phase 2/3 markers,
explicitly **out of scope** for this module, deferred later:
- Cloud security posture checks (excessive IAM privileges, open security groups, ineffective NACLs) —
  explicitly Phase 2/3 in section 7.3, a natural extension once cost visibility is proven, not part
  of it
- Tagging compliance reporting and unit economics reporting — same Phase 2/3 marker
- Policy-driven automation (auto-stop idle dev instances, enforce tagging) — Phase 2 per section 7.3
- GCP billing (architecture plan open decision #2: AWS and Azure first, GCP in Phase 2 — same
  boundary Module 2 used for monitoring)
- SaaS billing/subscription for Cloud Ops Tool's own tenants (tier caps, Stripe/Razorpay) — that's
  section 8's "Billing and subscription" platform service, a different thing from this module, which
  reports on a tenant's *cloud provider* spend, not what the tenant pays Cloud Ops Tool
- A migration plan — same reasoning as Module 2: there's no named existing FinOps tool/account
  currently tracking Tekpro's AWS/Azure spend to migrate off of. If one exists, that's an open
  question for section 8, not an assumption to build against.

---

## 2. What Module 1 and Module 2 Already Built That This Module Depends On

Same intent as Module 2's section 2: this module adds no new foundation, and reuses more of Module 2
directly than Module 2 reused of Module 1, because cost and cloud monitoring genuinely share the same
provider connection.

- **`resources`** (`resource_type` enum already includes `cloud_account`) — a connected billing
  account gets a `resources` row the same way a monitored server does, so cost data, monitoring data,
  and tickets all key off the same `resource_id`. This is what makes "resolve ticket as rightsized ->
  log the saving" (section 3, point 2) a join, not a cross-system lookup.
- **`cloud_credentials`** (Module 2 Sprint 4) — **reused as-is, not duplicated.** It already stores
  `provider` (`aws`/`azure`), `label`, `config` (jsonb credentials), `is_enabled`, `last_polled_at`
  per tenant, with its own admin CRUD UI already shipped (`CloudCredentialsAdmin.tsx`) and its own
  RLS policy. This module's billing sync job polls the same credential rows Module 2's cloud resource
  poller already polls. The one thing this module changes about `cloud_credentials` is what it
  documents as required: a tenant's AWS/Azure config now needs to also grant Cost Explorer / Cost
  Management read access, not just the describe/metrics access Module 2 needed. A tenant free to grant
  both scopes on one IAM identity, or add a second `cloud_credentials` row scoped only to billing —
  either is supported without a schema change, since nothing here assumes one credential per account.
- **`CloudProviderClient` interface** (`cloud-provider-client.ts`) — this module adds a
  `getCostAndUsage()` method to the same interface `listResources()`/`getMetrics()` already live on,
  implemented in the same `AwsCloudProviderClient`/`AzureCloudProviderClient` classes. Same DI-token
  swap-for-a-fake pattern Module 2 used to verify the poller without live cloud credentials
  (`CLOUD_PROVIDER_CLIENT_FACTORY`) applies directly to this module's billing sync job.
- **`alerts`** table (Module 2) — MTD pace breaches and hard budget-cap breaches are alerts, not a
  parallel notification concept. Architecture plan section 7.3 says this directly: "critical MTD
  breach can escalate to WhatsApp or a voice call the same way a P1 monitoring alert does." `alerts`
  already has two nullable source-reference columns (`monitor_id`, `alert_rule_id`) for exactly this
  kind of "which rule fired this" polymorphism; this module adds one more nullable FK
  (`cost_budget_id`) alongside them rather than inventing a second alerts table.
- **Notification dispatcher + `notification_templates`** — cost alerts render through the same
  `$VARIABLE`-substitution template mechanism Module 2 built, with new event types
  (`cost.pace_alert`, `cost.budget_breached`), not a second templating system.
- **The "needs attention" banner pattern** — a broken `cloud_credentials` connection already needs to
  surface for Module 2 (stale cloud-resource polling); this module's billing sync hitting the same
  broken credential is the same signal, read by both modules, shown once.
- **Admin page's grouped-sections pattern** — a new "Cost" group alongside "Monitoring", not a
  separate admin surface, same as every module before it.
- **`POST /internal/tickets/from_alert`** and the ticket-notes internal endpoint Module 2 added — a
  rightsizing recommendation converted to a ticket is a very similar shape to an alert converted to a
  ticket (resource context, a reason sentence, idempotent linking), and reuses the same internal
  contract rather than a parallel `/internal/tickets/from_recommendation` endpoint. See section 4.

---

## 3. Cost Data Model

```
cost_line_items
  id (uuid, pk)
  tenant_id
  cloud_credential_id (fk -> cloud_credentials)
  resource_id (fk -> resources, nullable)   -- populated when the provider's line item is
                                                attributable to a specific resource (resource-level
                                                cost granularity or a matching external_ref/tag);
                                                null for account- or service-level-only line items
  service                        -- e.g. "Amazon EC2", "Azure Virtual Machines"
  region (nullable)
  usage_date (date)              -- daily granularity, not timestamp -- matches how both Cost
                                     Explorer and Cost Management report
  amount (numeric)
  currency (text, default 'USD')
  raw (jsonb)                    -- provider's line item detail, kept for drill-down/debugging
  synced_at
  UNIQUE (cloud_credential_id, service, region, usage_date)   -- idempotent daily sync: a rerun
                                                                  upserts, never duplicates

cost_budgets
  id (uuid, pk)
  tenant_id
  cloud_credential_id (fk -> cloud_credentials, nullable)   -- null = applies tenant-wide, across
                                                                every connected account
  name
  monthly_budget_amount (numeric, nullable)   -- null = pace-only alerting, no hard cap
  pace_warning_threshold_pct (int, default 20)
  pace_critical_threshold_pct (int, default 40)
  is_active (bool, default true)
  created_at

rightsizing_recommendations
  id (uuid, pk)
  tenant_id
  resource_id (fk -> resources)
  recommendation_type (enum: rightsize, idle, terminate)
  reason_text                    -- auto-generated sentence, same one-generation-path principle
                                     Module 2 used for alert reason_text, e.g. "CPU utilization has
                                     averaged 4% over the last 14 days; consider downsizing or
                                     terminating"
  estimated_monthly_saving (numeric, nullable)
  status (enum: open, dismissed, ticket_created, resolved)
  ticket_id (fk -> tickets, nullable)
  created_at, updated_at

cost_savings_log
  id (uuid, pk)
  tenant_id
  resource_id (fk -> resources)
  recommendation_id (fk -> rightsizing_recommendations, nullable)
  ticket_id (fk -> tickets, nullable)
  expected_monthly_saving (numeric)
  actual_monthly_saving (numeric, nullable)   -- filled in by the materialization-check job,
                                                  section 5 -- null until there's enough post-change
                                                  cost_line_items history to compare against
  status (enum: logged, verified, not_materialized)
  logged_at, verified_at (nullable)
```

**On `alerts` (Module 2 table, extended, not duplicated):** add one nullable column,
`cost_budget_id (fk -> cost_budgets, nullable)`, alongside the existing nullable `monitor_id` /
`alert_rule_id`. A cost alert's `resource_id` points at the connected account's `resources` row
(`resource_type = 'cloud_account'`); `severity` maps directly from the pace tier (info/warning/
critical) architecture plan section 7.3 already defines.

**Notes on scale:** unlike `monitor_checks`, `cost_line_items` does not need a deferred-rollup
conversation. It's one row per connected account per service per region per day — even a tenant with
50 connected accounts across 20 AWS services generates roughly 1,000 rows/day, nowhere near the
volume that made Module 2 flag `monitor_checks` as the first candidate for splitting out of the
modular monolith (architecture plan section 4). Plain Postgres, no TimescaleDB/ClickHouse, is the
right call at this scale — same "defer the exotic storage until real data shows the shape of the
problem" reasoning the Module 2 doc used, just with an even clearer "not yet" answer here.

**On `tenants` (Module 1 table, extended, not a new table):** add two nullable columns,
`financial_year_start_month (int, default 1)` and `cost_rate_display (enum: list_price, negotiated,
default 'list_price')` — architecture plan section 8's two tenant-level cost settings. These are
1:1 tenant attributes, not their own entity with a lifecycle, so they belong directly on `tenants`
the same way any other tenant-scoped setting would, not in a separate one-row-per-tenant table.

---

## 4. API Contracts (Core Endpoints)

All endpoints are prefixed `/api/v1/`, same auth model as Modules 1 and 2 (agent JWT or
`X-Tenant-Id` header, per `TenantHeaderGuard`).

```
Cost dashboard (MSP rollup, section 7.3 -- the default landing page for this module)
  GET /cost/accounts_summary          one row per connected cloud_credentials account: previous
                                        month total, MTD total + % change, forecast + % change,
                                        6-7 month trend, top-spending breakdown (by service/region),
                                        one auto-generated insight sentence
  GET /cost/accounts/:credential_id/summary       same shape, single-account drill-down
  GET /cost/accounts/:credential_id/line_items    raw line items (filter: date range, service, region)

Budgets
  GET/POST /admin/cost_budgets
  PATCH    /admin/cost_budgets/:id

Recommendations
  GET      /cost/recommendations                  list (filter: resource_id, status, type)
  PATCH    /cost/recommendations/:id               dismiss / mark resolved
  POST     /cost/recommendations/:id/create_ticket  idempotent per recommendation (mirrors
                                                       alerts.ticket_id's one-ticket-per-alert rule)
                                                       -- calls the existing
                                                       /internal/tickets/from_alert contract with a
                                                       recommendation-shaped payload, not a new
                                                       internal endpoint

Savings tracking
  GET      /cost/savings_log                      list (filter: resource_id, ticket_id, status)

Tenant cost settings (architecture plan section 8)
  GET/PATCH /admin/tenant_cost_settings            financial_year_start_month, rate_display
                                                       (list_price | negotiated)

Internal, scheduled jobs only (no public endpoint, same shape as Module 2's cloud-resource-poller)
  -- daily billing sync: for each enabled cloud_credentials row, calls
     CloudProviderClient.getCostAndUsage(), upserts cost_line_items, then runs the MTD pace check
     against cost_budgets and fires alerts through the existing alerts table + notification
     dispatcher
  -- recommendation sweep: reads recent monitor_checks / cloud_metric data for cloud_account-typed
     resources' utilization signals, upserts rightsizing_recommendations
  -- savings materialization sweep: for cost_savings_log rows still status='logged' past some
     minimum window, compares cost_line_items before/after the linked ticket's resolved_at and
     fills in actual_monthly_saving
```

---

## 5. Core Business Logic to Get Right Early

- **MTD pace, not flat threshold, exactly as architecture plan section 7.3 specifies:**
  `pace_adjusted_expected = (mtd_spend / days_elapsed) * days_in_month`. Compare actual MTD spend
  against that, not against a static "$X so far this month" number, so a real spike on day 5 doesn't
  hide behind a small absolute total. Tiering (10-20% over pace = info, 20-40% = warning, >40% or a
  hard `monthly_budget_amount` breach = critical) is a direct port of section 7.3's own numbers —
  confirm these in section 8 rather than silently accepting them as final.
- **Idempotent daily sync, same principle as every sweep job in this codebase so far** (Module 1's
  `OverdueSweepService`, Module 2's escalation sweep): the billing sync job is safe to rerun.
  `cost_line_items`'s unique constraint on `(cloud_credential_id, service, region, usage_date)` makes
  a rerun an upsert, not a duplicate-row producer, the same guarantee `alerts`' partial unique index
  gives Module 2 against double-firing.
- **Insight sentences are one generation path, read in three places** — the dashboard card, the
  notification body, and (once a recommendation exists) the ticket's first note — exactly the pattern
  Module 2's `reason_text` established for alerts. "{Account}'s month-to-date spend is up {pct}%, and
  forecasted to {rise/drop} by {pct}% next month" is a template keyed off the same pace calculation
  above, not independently written prose per surface.
- **Recommendation-to-ticket linking is idempotent per recommendation** (`status` moves
  `open -> ticket_created`, `rightsizing_recommendations.ticket_id` set once), same shape as
  `alerts.ticket_id`. A recommendation that's still open on a later sweep run updates its
  `reason_text`/`estimated_monthly_saving` in place rather than creating a second recommendation row
  for the same resource and type.
- **Rightsizing recommendations read Module 2's existing utilization data — they do not collect their
  own metrics.** The recommendation sweep queries `monitor_checks` rows already written by Module 2's
  cloud-metric monitors (CPU/memory over the trailing window) for `cloud_account`/`server`-typed
  resources. This is the concrete instance of architecture plan section 4's "single data model across
  modules" claim actually paying off, not just an architectural talking point.
- **Broken billing connections are the same config-error signal Module 2 already surfaces, not a
  second one.** `cloud_credentials.is_enabled` / `last_polled_at` going stale is read by both this
  module's billing sync and Module 2's resource poller; the needs-attention banner shows one entry
  per broken credential, not one from each module.
- **Savings materialization is checked later, by a separate sweep, not inline at ticket resolution.**
  You cannot know whether a "terminate this idle instance" saving materialized the moment the ticket
  is marked resolved — you need at least one full subsequent billing cycle of `cost_line_items` to
  compare against. `cost_savings_log.status` stays `logged` until that sweep has enough post-change
  data, then flips to `verified` or `not_materialized`. Don't try to compute this synchronously.
- **Financial year start month and list-price-vs-negotiated-rate (architecture plan section 8) are
  tenant-level settings that change what "this month" and "this amount" mean everywhere** — the MTD
  calculation, the dashboard's month labels, and the budget comparison all read the same tenant
  setting rather than assuming a January-December calendar year or list pricing. Get this wired
  through from Sprint 1's data model, not retrofitted after the dashboard already assumes calendar
  months.

---

## 6. Frontend Scope

- **MSP multi-account rollup as the default landing page** (section 7.3): a scrollable list of every
  connected account, each card showing previous month total, current MTD total with % change,
  forecast with % change, a small 6-7 month trend chart, and a top-spending-by-service/region
  breakdown — the same "fleet view first" principle Module 2's fleet page and Module 1's dashboard
  both already use as their landing page.
- **Per-account drill-down page**: same card shape as the rollup, expanded, plus the raw line-item
  table with date-range/service/region filters.
- **Recommendations list**: reason text, estimated saving, "create ticket" / "dismiss" actions,
  status filter.
- **Savings log view**: expected vs. actual saving per resolved recommendation, status.
- **Admin UI**: a new "Cost" group on the admin page (alongside Team/Support
  Operations/Workflows/Monitoring) housing budgets CRUD and the tenant cost settings form
  (financial year start month, rate display toggle). `cloud_credentials` management itself stays
  exactly where Module 2 put it — this module doesn't move or duplicate that admin panel.
- **Needs-attention banner integration**: broken billing connections feed the same banner component,
  reusing the exact signal Module 2 already surfaces for the same table (section 2).

---

## 7. Sprint Plan (2-week sprints, small team)

**Sprint 1: Billing ingestion core**
`cost_line_items` table + RLS. Extend `CloudProviderClient` with `getCostAndUsage()` on both the AWS
and Azure implementations. Daily sync job (idempotent upsert per the unique constraint in section 3).
No dashboard yet — this sprint proves real cost data lands in the table correctly, the same
"prove the mechanism before the UI" order Module 2 Sprint 1 used for checks.

**Sprint 2: MTD pace + budget alerting — the differentiator**
`cost_budgets` table, the `alerts.cost_budget_id` addition, MTD pace calculation with the
info/warning/critical tiers, wired through the existing `alerts` table and notification dispatcher.
This is the sprint where architecture plan section 7.3's "critical MTD breach can escalate to
WhatsApp/voice the same way a P1 monitoring alert does" claim becomes real and testable, mirroring
what Module 2 Sprint 2 did for alert-to-ticket.

**Sprint 3: MSP rollup dashboard**
`GET /cost/accounts_summary` and the per-account drill-down endpoint, insight-sentence generation,
the frontend rollup page and drill-down page. This is the first sprint anyone actually looks at cost
data day to day rather than just trusting the pipeline works.

**Sprint 4: Rightsizing recommendations**
`rightsizing_recommendations` table, the recommendation sweep reading Module 2's existing
`monitor_checks` utilization data, recommendation-to-ticket linking via the existing
`/internal/tickets/from_alert` contract, the recommendations list UI.

**Sprint 5: Savings tracking + tenant cost settings**
`cost_savings_log`, the materialization sweep job, financial-year-start-month and
list-price-vs-negotiated-rate tenant settings (architecture plan section 8) wired through the pace
calculation and dashboard, the "Cost" admin group UI.

**Sprint 6: Frontend hardening + real usage**
Needs-attention banner integration, admin polish, savings log view. Real usage against Tekpro's own
actual AWS/Azure bill for a trial period before this is considered done — same "prove it on tenant
zero first" approach Module 1 and Module 2 both used, and the most meaningful test this module can
get, since a wrong MTD pace calculation or a bad rightsizing suggestion against your own real spend
will surface immediately in a way synthetic data wouldn't.

That's roughly 12 weeks, matching Module 2's cadence. Per architecture plan section 4 and the Module 2
doc's own section 7 note, this module is the one that genuinely can't start until Module 2's cloud
resource monitoring (Sprint 4 there) is live, since Sprint 4 here reads data Module 2 has to be
writing first.

---

## 8. Open Decisions Needing Your Confirmation Before Build Starts

1. **Confirm AWS + Azure as the first two providers for cost data too** — carried forward from
   Module 2's same open question (architecture plan open decision #2), but worth confirming
   separately since a tenant could in principle want cost visibility on a provider it doesn't want
   monitored, or vice versa.
2. **Does Tekpro's own AWS/Azure billing access exist and is it ready to grant Cost Explorer / Cost
   Management read permissions?** Module 2 needed real infra to monitor for its Sprint 3/4 pilot;
   this module needs the equivalent for Sprint 1 — real billing API access for tenant zero, not
   synthetic data, since section 6's "prove it on tenant zero first" is only meaningful against real
   numbers.
3. **Pace alert thresholds**: confirm 20%/40% over pace as the warning/critical defaults (architecture
   plan section 7.3's own numbers), or does Tekpro's own budget-management experience suggest
   different starting points? Same "one-line config default, biggest lever on whether it feels useful
   or noisy" situation Module 2's debounce-default question was.
4. **Tekpro's financial year start month and rate-display preference** (list price vs. negotiated
   rate) — needed to seed tenant zero's `tenant_cost_settings` correctly from Sprint 5, and to know
   whether "MTD" for Tekpro's own dashboard means calendar-month or fiscal-month from day one.
5. **Who owns budget configuration for Sprint 2** — is Vincent setting the initial `cost_budgets`
   rows for Tekpro's connected accounts, or does that need input from whoever currently tracks
   Tekpro's own cloud spend informally today?
6. **Rightsizing recommendation thresholds** (e.g. "CPU averaged under 5% over 14 days" for an idle
   flag) aren't specified in the architecture plan at the level of a concrete number — Sprint 4 needs
   a starting definition of "idle" and "oversized" before it can generate its first real
   recommendation against Tekpro's own infra.
