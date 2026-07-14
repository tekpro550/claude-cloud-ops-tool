# Cloud Ops Tool
## Module 2 Build Scope: Monitoring
### Data models, API contracts, and sprint plan

Companion document to Cloud-Ops-Tool-Architecture-Plan.md, in the same style as
Cloud-Ops-Tool-Module1-Foundation-Ticketing-Scope.md. Unlike Module 1, none of this has been
confirmed with you yet — section 8 lays out what needs a decision before build starts, the same
way section 11 of the architecture plan did before Module 1 began. Nothing here is committed.

---

## 1. Scope Boundary

This module covers uptime/synthetic monitoring, a server agent for Tekpro's own infrastructure,
cloud resource monitoring via provider APIs, alert rules with grouping/dedup, and the
alert-to-ticket link that's the product's core differentiator (architecture plan section 3, point
2). It builds entirely on foundation pieces Module 1 already shipped and proved out: the `resources`
table, the `groups` table (reused as-is for monitor organization, not a separate grouping concept —
architecture plan section 7.2 is explicit that this should share the ticketing module's grouping
rather than invent a second one), the event bus, the notification dispatcher, real agent login, and
`POST /internal/tickets/from_alert`, which already exists and is already tested against a mock
payload specifically so Module 2 has a real contract to build against.

Per the architecture plan's Phase 1 scope (section 9) and open decision #2 (section 11), explicitly
**out of scope** for this module, deferred to Phase 2/3:
- Public status pages (Phase 2, "Productize")
- WhatsApp/voice alert delivery actually reaching Tittu/Ginger (the notification dispatcher already
  has `whatsapp`/`voice` as channel enum values from Module 1, but real delivery integration is
  Phase 2 per section 9 — Module 2 alerts route through the same dispatcher and will "just work" on
  those channels once that integration lands, no monitoring-side change needed)
- Log query / natural-language "Ask Zia" equivalent (explicitly Phase 2 in section 7.2)
- Plugin/integration marketplace with proactive suggestions (a growth/adoption feature, not core
  MVP monitoring)
- GCP support (architecture plan recommends AWS and Azure first, GCP in Phase 2 — open decision #2)
- Policy-driven automation (auto-stop idle instances etc. — that's cost module territory per section
  7.3, Phase 2 there too)

Also out of scope: a migration plan. Module 1 had one because Tekpro's ticketing history genuinely
lives in a specific, named Freshdesk account today (tekprocloud.freshdesk.com) with real historical
tickets worth carrying over. There's no equivalent evidence of a specific existing monitoring tool
and account currently watching Ginger/Tittu infra that this module needs to migrate off of — if one
exists, that's an open question for section 8, not an assumption to build against.

---

## 2. What Module 1 Already Built That This Module Depends On

No foundation schema changes are needed to start Module 2 — this is intentionally different from
Module 1, which had to stand up tenancy/RLS/the event bus/the resource entity from nothing. Module 2
builds directly on:

- **`resources`** (`id`, `tenant_id`, `name`, `resource_type` enum, `group_name`,
  `external_ref` jsonb, `tags` jsonb) — `resource_type`'s existing values (`server`, `cloud_account`,
  `service`, `website`, `database`, `other`) already cover everything section 7.2 needs to monitor.
  `external_ref` is exactly where a cloud provider's resource ID (an EC2 instance ARN, an Azure
  resource ID) belongs, per the Module 1 doc's own comment on that column ("filled in by Module
  2/3").
- **`groups`** — reused directly for "client/group based monitor organization" (section 7.2). A
  monitor's resource already carries a group through its `resources.group_name`, so no new grouping
  table is needed.
- **`events`** (event bus, Redis Streams-backed) — `alert.created` is already a documented
  `event_type` example in the Module 1 foundation schema comment. This module is what actually emits
  it.
- **`notifications`** + the dispatcher — alert delivery reuses this as-is; `channel`,
  `template_name`, `payload`, `status` already fit an alert notification without changes.
- **Real agent login** (JWT, `users`/`agents` tables) — escalation policies and on-call schedules
  reference `agents.id` directly, the same way ticket assignment does.
- **`POST /internal/tickets/from_alert`** — already live, already guarded, already tested with a
  mock payload (`verify-internal-tickets.ts`). This module's alert-firing logic is the first real
  caller it's ever had.
- **The "needs attention" banner pattern** — Module 1's version surfaces contacts needing action;
  this module extends the same mechanism with configuration errors and suspended monitors (section
  7.2), not a parallel banner system.

---

## 3. Monitoring Data Model

```
monitors
  id (uuid, pk)
  tenant_id
  resource_id (fk -> resources)
  monitor_type (enum: http, ping, port, dns, ssl, server_agent, cloud_metric)
  name
  config (jsonb)              -- shape depends on monitor_type: {url, expected_status} for http,
                                  {host, port} for port/ping, {metric, provider} for cloud_metric, etc.
  interval_seconds (int, default 60)
  consecutive_failures_to_alert (int, default 2)   -- dedup/debounce: don't fire on one blip
  is_active (bool, default true)
  created_at, updated_at

monitor_checks
  id (uuid, pk)
  tenant_id
  monitor_id (fk -> monitors)
  status (enum: up, down, critical, trouble)
  response_time_ms (int, nullable)
  raw_output (jsonb)           -- provider/check-specific detail, e.g. HTTP status code, ping loss %
  checked_at
  -- High-volume, append-only, time-ordered. Partition or roll up to hourly/daily aggregates once
  -- volume actually demands it (section 5) -- not needed for tenant zero's own infra at MVP scale.

agent_tokens
  id (uuid, pk)
  tenant_id
  resource_id (fk -> resources)     -- the server this token identifies
  token_hash
  last_seen_at (nullable)           -- staleness detection: no report in N minutes -> config error bucket
  created_at, revoked_at (nullable)

alert_rules
  id (uuid, pk)
  tenant_id
  monitor_id (fk -> monitors, nullable)   -- null = applies to every monitor of resource_type below
  resource_type (enum, nullable)          -- alternative to monitor_id, for a type-wide rule
  name
  condition (jsonb)              -- {metric, operator, threshold} e.g. {metric: "disk_percent", operator: ">", threshold: 80}
  severity (enum: info, warning, critical)
  is_active (bool, default true)
  created_at

alerts
  id (uuid, pk)
  tenant_id
  resource_id (fk -> resources)
  monitor_id (fk -> monitors, nullable)
  alert_rule_id (fk -> alert_rules, nullable)
  severity (enum: info, warning, critical)
  status (enum: open, acknowledged, resolved)
  reason_text                    -- auto-generated plain sentence, e.g. "Disk utilization of / exceeds 80 percent"
  ticket_id (fk -> tickets, nullable)   -- set once linked via /internal/tickets/from_alert
  triggered_at
  acknowledged_at (nullable)
  resolved_at (nullable)

downtime_events
  id (uuid, pk)
  tenant_id
  resource_id (fk -> resources)
  started_at
  ended_at (nullable)
  note
  is_manual (bool, default true)   -- manual outage entry (section 7.2) vs auto-detected
  entered_by (fk -> agents, nullable)
  created_at

escalation_policies
  id (uuid, pk)
  tenant_id
  name
  steps (jsonb)               -- ordered: [{delay_minutes, notify_group_id | notify_agent_id, channel}]
  is_active (bool, default true)

on_call_schedules
  id (uuid, pk)
  tenant_id
  group_id (fk -> groups)
  entries (jsonb)              -- [{agent_id, starts_at, ends_at}], simple rotation, not a full rrule engine at MVP

notification_templates
  id (uuid, pk)
  tenant_id
  channel (enum: email, whatsapp, voice, in_app)
  event_type                   -- matches events.event_type, e.g. "alert.created"
  body                         -- with $RESOURCE_NAME / $STATUS / $GROUP_NAME / $CHECK_TYPE placeholders (section 7.2)
  is_default (bool, default false)   -- tenant hasn't customized -> fall back to a built-in template
```

**Notes on scale:** `monitor_checks` is the one table here that doesn't follow the Module 1 pattern
of "small, low-volume, plain Postgres row per event." At even a modest polling interval across a
real fleet this grows fast. Fine for tenant zero's own infra at MVP scale (the architecture plan's
own reasoning in section 4 flags "monitoring ingestion is the most likely first candidate" to
eventually need splitting out of the modular monolith) — but worth deciding now whether Module 2
starts with a retention/rollup job (e.g. raw checks kept 7 days, hourly rollups kept longer) or
defers that until it's actually a problem. Recommend deferring: build the table plain, add the job
in a later sprint once real check volume shows the shape of the problem, rather than guessing at
retention policy before there's data to look at.

---

## 4. API Contracts (Core Endpoints)

All endpoints are prefixed `/api/v1/`, same auth model as Module 1 (agent JWT or `X-Tenant-Id`
header, per `TenantHeaderGuard`).

```
Monitors
  GET/POST /monitors                       list (filter: resource_id, group via resource, status), create
  GET      /monitors/:id
  PATCH    /monitors/:id
  DELETE   /monitors/:id
  GET      /monitors/:id/checks            recent check history for one monitor (the "events timeline" data source)

Fleet / dashboard
  GET      /monitoring/fleet_summary       counts by status (up/down/critical/trouble), config errors,
                                             suspended monitors -- the default landing page's summary strip
  GET      /resources/:id/dashboard        per-resource KPI strip + events timeline + latest checks,
                                             one reusable shape regardless of resource_type (section 7.2)

Alerts
  GET      /alerts                         list (filter: status, severity, resource_id, group)
  GET      /alerts/:id
  PATCH    /alerts/:id                     acknowledge / resolve
  POST     /alerts/:id/link_ticket         manually link an already-open ticket, for the case an
                                             agent created one before the auto-link fired

Downtime
  GET/POST /resources/:id/downtime_events  manual outage entry (section 7.2)
  PATCH    /downtime_events/:id

Admin
  GET/POST /admin/alert_rules
  GET/POST /admin/escalation_policies
  GET/POST /admin/on_call_schedules
  GET/POST /admin/notification_templates

Agent ingestion (called by the Go server agent, not a browser)
  POST     /agent/heartbeat                {resource_id, token} -> updates agent_tokens.last_seen_at
  POST     /agent/report                   {resource_id, token, cpu, memory, disk, processes}
                                             -> writes monitor_checks rows, evaluates alert_rules

Cloud provider ingestion (polled by a scheduled job, not agent-pushed)
  -- internal only, no public endpoint: a scheduled job calls each connected provider's read-only
     monitoring API directly and writes monitor_checks rows the same way agent reports do

Internal (already exists, built in Module 1)
  POST     /internal/tickets/from_alert    this module's alert-firing logic becomes its first real caller
```

---

## 5. Core Business Logic to Get Right Early

- **Alert firing needs debounce, not raw threshold-crossing.** `monitors.consecutive_failures_to_alert`
  exists specifically so one slow HTTP response or one dropped ping doesn't fire a P1 — this is the
  direct fix for the "alert fatigue" complaint the architecture plan calls out as Site24x7's most
  repeated criticism (section 2). Get the debounce window right before anything else in this module,
  since it's the one thing that determines whether agents trust the alerts at all.
- **Auto-generated reason text is a small, fixed set of sentence templates keyed off `condition`,
  not free text.** `"{metric_label} of {resource_name} exceeds {threshold}{unit}"` covers most
  threshold rules; a handful of special cases (server down, SSL expiring) get their own template.
  This is the same string that shows on the resource dashboard, in the alert itself, and becomes the
  first message on the auto-created ticket (section 7.2) — one generation path, three places it's
  read, not three separate copies to keep in sync.
- **Alert-to-ticket linking is idempotent per alert, and the ticket keeps a live `resource_id`
  reference, not a snapshot.** One alert creates at most one ticket (`alerts.ticket_id`); a
  duplicate/repeated alert on an already-linked, still-open ticket adds a note to the existing
  ticket instead of opening a second one — the direct implementation of section 3's "alert to ticket"
  differentiator without also reintroducing the alert-flood problem the debounce point above is
  trying to solve.
- **Agent staleness is a first-class state, not a silent gap.** A server agent that stops reporting
  (crashed, network partition, host decommissioned without deregistering) should surface as a
  "configuration error," the same bucket as a broken cloud billing connection in the cost module
  (section 7.2's own comparison) — checked via `agent_tokens.last_seen_at` against a threshold, not
  inferred from `monitor_checks` simply going quiet (which is indistinguishable from "nothing to
  report" without an explicit heartbeat).
- **Escalation steps are relative delays from `alerts.triggered_at`, evaluated by a sweep job** — the
  same "background job recalculates, not stored as text" principle Module 1 used for SLA due dates.
  A step firing late because the sweep interval is coarse is an acceptable tradeoff at this scale;
  computing absolute fire times and storing them as if they were static is not, since an
  acknowledged/resolved alert needs to cancel remaining steps cleanly.
- **Cloud provider polling is pull, agent reporting is push** — different trust models. The Go agent
  authenticates with a token it holds and pushes its own data; cloud provider metrics get pulled by
  a tenant-scoped scheduled job using credentials the tenant granted (principle of least privilege,
  per architecture plan section 10), never the other way around.

---

## 6. Frontend Scope

- **Fleet-wide status view as the default landing page** (section 7.2): summary strip (counts by
  status + config errors + suspended monitors) above the full monitor list (status icon, resource
  type, one relevant metric, last polled time).
- **Per-resource dashboard**, one reusable template regardless of resource type: KPI strip
  (availability %, CPU/memory/disk where applicable, downtime count, SLA achieved), a colored
  events timeline bar, then detail tabs (metrics, checks, notes/inventory) — not a bespoke page per
  resource type.
- **Alert list + detail**: acknowledge/resolve actions, link to the auto-created ticket once one
  exists, manual "link to existing ticket" action.
- **Admin UI** for alert rules, escalation policies, on-call schedules, notification templates —
  same "grouped sections, setup completeness indicators" pattern as Module 1's admin page, added as
  a new group (e.g. "Monitoring") alongside Team/Support Operations/Workflows rather than a separate
  admin surface.
- **Manual outage entry form** on a resource's dashboard.
- **Needs-attention banner integration**: configuration errors and suspended monitors feed the same
  banner component Module 1 built generically for exactly this.

---

## 7. Sprint Plan (2-week sprints, small team)

**Sprint 1: Monitor engine core**
`monitors` / `monitor_checks` tables + RLS. Uptime/synthetic checks (HTTP, ping, port, DNS, SSL) with
a scheduler running each monitor on its configured interval. Monitor CRUD API. No alerting yet —
this sprint proves checks actually run and get recorded.

**Sprint 2: Alerting + the differentiator**
`alert_rules` / `alerts` tables. Threshold evaluation with debounce
(`consecutive_failures_to_alert`), auto-generated reason text, `alert.created` event emission, and
wiring that event to `/internal/tickets/from_alert` end to end — the first real exercise of that
existing endpoint. This is the sprint where the "alert becomes a ticket automatically" claim from
architecture plan section 3 becomes real and testable, not aspirational.

**Sprint 3: Server agent**
The Go agent binary (CPU/memory/disk/process health), `agent_tokens`, `/agent/heartbeat` +
`/agent/report` ingestion endpoints, staleness detection feeding the configuration-error bucket.
Deployed against Tekpro's own Ginger/Tittu infra as the first real, non-synthetic monitoring target.

**Sprint 4: Cloud resource monitoring**
AWS and Azure read-only monitoring API polling (GCP deferred per section 1), writing into the same
`monitor_checks` shape the agent and synthetic checks already use. This is also where
`resources.external_ref` actually starts getting populated with real provider IDs.

**Sprint 5: Escalation, on-call, downtime**
`escalation_policies`, `on_call_schedules`, the sweep job that walks escalation steps, manual
`downtime_events` entry, `notification_templates` with variable substitution.

**Sprint 6: Frontend + hardening**
Fleet-wide status view, per-resource dashboard template, alert list/detail, all the admin UIs from
section 6, needs-attention banner integration. Real usage against Tekpro's own infra for a trial
period before this is considered done, the same "prove it on tenant zero first" approach Module 1
used.

That's roughly 12 weeks. Module 2 needs Module 1's `/internal/tickets/from_alert` (already live) and
nothing else outside what's already built, so this can start immediately — it doesn't wait on Module
3 (Cost), which is the module that actually depends on this one being live first (rightsizing
recommendations reference live monitoring data, per section 7.3).

---

## 8. Open Decisions Needing Your Confirmation Before Build Starts

Unlike Module 1, where you'd already confirmed the migration approach, the pilot mailbox, and the
initial agent list before anything got built, none of the following have been discussed yet:

1. **Is there a monitoring tool watching Ginger/Tittu infra today?** Module 1 had a real migration
   plan because Freshdesk's account and ticket history are known and named. If something equivalent
   already exists for monitoring (even an informal one — a script, a cron job, a third-party
   dashboard), it needs the same treatment: what to carry over, what to leave behind, what "parity"
   means before cutover. If nothing exists today, this module simply has no migration section and
   that's the answer.
2. **Which specific servers/resources are the initial pilot monitoring targets?** Module 1 named six
   real agents and a real mailbox up front. This module needs the equivalent: which Ginger/Tittu
   hosts, which URLs/services, get the first synthetic checks and the first agent installs in Sprint
   1/3, so there's a real target to build and test against rather than a synthetic one.
3. **Confirm AWS + Azure as the first two cloud providers** (architecture plan open decision #2
   recommends this, GCP in Phase 2) — carried forward here since it directly determines Sprint 4's
   scope.
4. **Debounce defaults**: is `consecutive_failures_to_alert = 2` (two consecutive bad checks before
   firing) the right default, or does Tekpro's own experience with Site24x7's alert fatigue suggest
   a different starting point? This is a one-line config default, but it's the single biggest lever
   on whether the alerting sprint (Sprint 2) actually feels calmer than the incumbent it's replacing.
5. **Escalation policy ownership**: who defines the initial escalation policies and on-call rotation
   for Sprint 5 — is that Vincent, or does it need input from whoever currently handles Ginger/Tittu
   incidents operationally?
