# Cloud Ops Tool
## Module 1 Build Scope: Foundation + Ticketing
### Data models, API contracts, and sprint plan

Companion document to Cloud-Ops-Tool-Architecture-Plan.md. This is the detailed scope for the first thing that actually gets built.

---

## 1. Scope Boundary

This module covers everything needed to run Tekpro's cloud support ticketing on Cloud Ops Tool, end to end, in production, for tenant zero (Tekpro/MadVR internal use). It explicitly does not include monitoring or cost, those are Module 2 and Module 3. It does include the shared foundation pieces (tenancy, auth, the resource entity, the event bus, the notification dispatcher) since Ticketing is the module that proves those out first.

Out of scope for this module: AI agent auto response, WhatsApp/voice channel integration (Phase 2), public status pages, billing/subscription for external tenants. Tenant zero doesn't pay itself, so subscription billing isn't needed yet, just the tenant record structure that will support it later.

---

## 2. Foundation Data Model

```
-- Tenancy
tenants
  id (uuid, pk)
  name
  slug
  plan_tier (enum: internal, starter, growth, scale)
  financial_year_start_month (int, default 4)
  created_at, updated_at

users
  id (uuid, pk)
  tenant_id (fk -> tenants, RLS partition key)
  email
  name
  password_hash
  role (enum: admin, agent, viewer)
  created_at, updated_at

-- Every RLS-protected table below carries tenant_id and a policy:
--   USING (tenant_id = current_setting('app.current_tenant')::uuid)

-- Shared resource entity (referenced by Ticketing now, Monitoring/Cost later)
resources
  id (uuid, pk)
  tenant_id (fk -> tenants)
  name                    -- e.g. "sas-tittu-emailapp-linux-prod-sg-001"
  resource_type (enum: server, cloud_account, service, website, database, other)
  group_name              -- client/group label, e.g. "Tekpro", "Simandhar" (MSP grouping)
  external_ref (jsonb)    -- provider-specific IDs, filled in by Module 2/3
  tags (jsonb)
  created_at, updated_at

-- Event bus log (Redis Streams backed, this table is the durable audit trail)
events
  id (uuid, pk)
  tenant_id (fk -> tenants)
  event_type              -- e.g. "ticket.created", "alert.created" (Module 2), "cost.anomaly" (Module 3)
  payload (jsonb)
  created_at

-- Notification dispatch log
notifications
  id (uuid, pk)
  tenant_id (fk -> tenants)
  channel (enum: email, whatsapp, voice, in_app)
  recipient
  template_name
  payload (jsonb)
  status (enum: queued, sent, failed)
  created_at, sent_at
```

**Notes on RLS:** every query path goes through a connection-scoped `SET app.current_tenant = '<tenant_id>'` set by the API gateway after auth, before any query touches these tables. This is enforced at the database layer, not just checked in application code, so a bug in a service can't leak one tenant's tickets into another tenant's view.

---

## 3. Ticketing Data Model

```
groups
  id (uuid, pk)
  tenant_id
  name                     -- e.g. "Cloud Support"
  description
  created_at

agents
  id (uuid, pk)
  tenant_id
  user_id (fk -> users)
  group_ids (uuid[])
  is_active

companies
  id (uuid, pk)
  tenant_id
  name
  domain

contacts
  id (uuid, pk)
  tenant_id
  company_id (fk -> companies, nullable)
  name
  email
  phone
  social_handles (jsonb)

ticket_types
  id (uuid, pk)
  tenant_id
  name                     -- e.g. "Cloud Support - Azure"
  default_group_id
  default_sla_policy_id

sla_policies
  id (uuid, pk)
  tenant_id
  name
  first_response_target_minutes
  resolution_target_minutes
  business_hours_only (bool)
  escalation_rules (jsonb)

tickets
  id (uuid, pk)
  tenant_id
  ticket_number (int, sequential per tenant)
  legacy_ticket_number (int, nullable)      -- original Freshdesk ticket number, for migrated tickets
  subject
  contact_id (fk -> contacts)
  ticket_type_id (fk -> ticket_types)
  status (enum: new, open, pending, resolved, closed)
  priority (enum: low, medium, high, urgent)
  group_id (fk -> groups)
  agent_id (fk -> agents, nullable)
  resource_id (fk -> resources, nullable)   -- populated when created from a Module 2 alert
  sla_policy_id (fk -> sla_policies)
  first_response_due_at
  first_response_at (nullable)
  resolution_due_at
  resolved_at (nullable)
  source (enum: email, web_form, whatsapp, chat, api, alert)
  created_at, updated_at

ticket_messages
  id (uuid, pk)
  tenant_id
  ticket_id (fk -> tickets)
  type (enum: reply, note, forward)
  author_type (enum: agent, contact, system)
  author_id (nullable)
  body (text)
  cc (text[])
  created_at

ticket_attachments
  id (uuid, pk)
  tenant_id
  ticket_message_id (fk -> ticket_messages)
  file_name
  file_size_bytes
  storage_path            -- S3 key

ticket_todos
  id (uuid, pk)
  tenant_id
  ticket_id (fk -> tickets)
  text
  is_done (bool)
  reminder_at (nullable)

ticket_time_logs
  id (uuid, pk)
  tenant_id
  ticket_id (fk -> tickets)
  agent_id (fk -> agents)
  minutes
  note
  logged_at

automations
  id (uuid, pk)
  tenant_id
  name
  trigger (enum: ticket_created, ticket_updated, time_based, alert_received)
  conditions (jsonb)
  actions (jsonb)         -- e.g. set group, set priority, assign agent, send notification
  is_active

canned_responses
  id (uuid, pk)
  tenant_id
  title
  body
```

---

## 4. API Contracts (Core Endpoints)

All endpoints are prefixed `/api/v1/` and require a bearer token resolved to a tenant + user by the gateway.

```
Tickets
  GET    /tickets                     list with filters: status, priority, group_id, agent_id, sla_state
  POST   /tickets                     create (used by email intake, web form, and Module 2 alert linking)
  GET    /tickets/:id
  PATCH  /tickets/:id                 update properties: status, priority, group_id, agent_id, ticket_type_id
  POST   /tickets/:id/messages        add a reply, note, or forward
  POST   /tickets/:id/todos
  PATCH  /tickets/:id/todos/:todo_id
  POST   /tickets/:id/time_logs
  GET    /tickets/:id/timeline        merged view of messages, property changes, time logs

Dashboard
  GET    /dashboard/counters          unresolved, overdue, due_today, open, on_hold, unassigned (scoped by group)
  GET    /dashboard/trends            hourly volume today vs yesterday
  GET    /dashboard/sla_summary       resolution-within-SLA %, avg first response time

Admin
  GET    /admin/setup_status          per-section configured/total counts, for the setup completeness indicators
  GET/POST /admin/groups
  GET/POST /admin/sla_policies
  GET/POST /admin/ticket_types
  GET/POST /admin/automations
  GET/POST /admin/canned_responses

Contacts and Companies
  GET/POST /contacts
  GET/POST /companies

Internal (called by Module 2 once it exists, stubbed now)
  POST   /internal/tickets/from_alert   creates a ticket from a monitoring alert payload,
                                          setting resource_id, ticket_type_id, and priority automatically
```

---

## 5. Core Business Logic to Get Right Early

- **SLA calculation:** a background job recalculates `first_response_due_at` and `resolution_due_at` whenever a ticket's SLA policy or business hours changes, and a separate job sweeps for newly overdue tickets to fire the "overdue" event (which the notification dispatcher turns into an alert). The relative framing ("due in 5 hours", "overdue by a day") is computed at render time from these two timestamps, not stored as text.
- **Automation engine:** evaluate rules in a fixed order (matching Freshdesk's Dispatch'r/Observer split: rules that fire on ticket creation vs rules that fire on any update) so behavior is predictable when multiple rules could match the same ticket.
- **Ticket numbering:** sequential per tenant, not globally, so tenant zero's ticket #1 doesn't collide with or reveal volume of any future tenant.
- **The `/internal/tickets/from_alert` endpoint** is the seam Module 2 will call. Building it now, even with no real caller yet, forces the ticket creation logic to be reusable rather than baked only into the manual "agent creates a ticket" path.

---

## 6. Frontend Scope

- Dashboard (counters + trend graph + SLA summary, scoped by group)
- Ticket list (fleet view: filters, card layout, SLA state badges)
- Ticket detail (message thread, properties panel, customizable side panel with contact info/timeline/time logs/to-dos, reply/note/forward composer)
- Contacts and Companies list views
- Admin settings (grouped sections with setup completeness indicators: Team, Workflows, Support Operations)
- Persistent top-level "needs attention" banner component (built generically now, since Modules 2 and 3 will reuse it)

---

## 7. Sprint Plan (2-week sprints, small team)

**Sprint 0: Foundation**
Tenant/user/auth scaffold with RLS enforced at the database layer. Resource entity table (empty, unused until Module 2, but the schema exists). Event bus wiring (Redis Streams) with a single test event flowing end to end. Notification dispatcher skeleton with email channel only (WhatsApp/voice stay stubbed until Phase 2). CI/CD pipeline and the modular monolith's service boundaries scaffolded.

**Sprint 1: Ticket core**
Tickets, ticket_messages, contacts, companies, groups, ticket_types tables. Core API: create/list/get/update ticket, add message. Minimal ticket list and ticket detail UI, no SLA or automation yet. Email intake working (a mailbox that turns incoming mail into a ticket).

**Sprint 2: SLA and notifications**
SLA policies, first response/resolution due date calculation, the overdue sweep job, relative time framing in the UI. Notification dispatcher fires on ticket created/updated/overdue via email. Properties panel (status, priority, group, agent) fully editable.

**Sprint 3: Automation, to-dos, time logs**
Automation rule engine (creation-triggered and update-triggered rules), canned responses, ticket to-dos, ticket time logs. Customizable side panel (drag to reorder, toggle visibility).

**Sprint 4: Dashboard and admin**
Dashboard counters, trends graph, SLA summary. Admin settings pages with setup completeness indicators. The persistent "needs attention" banner, generalized so Modules 2 and 3 can plug into it later. The `/internal/tickets/from_alert` endpoint built and tested with a mock payload, so Module 2 has a real contract to integrate against.

**Sprint 5: Hardening and cutover**
Real usage by Tekpro's cloud support team on tenant zero, replacing the current Freshdesk workflow for a trial period. Bug fixing against real tickets. Data migration tooling to pull historical tickets out of the existing Freshdesk account, if you want ticket history carried over rather than starting fresh.

That's roughly 12 weeks to a working, internally-used Ticketing module, at which point Module 2 (Monitoring) starts and immediately has a live ticketing system to link alerts into.

---

## 8. Decisions Confirmed

1. **Historical ticket migration: yes.** Tickets from the current Freshdesk account (tekprocloud.freshdesk.com) get migrated in rather than starting tenant zero on a clean slate. See section 9 for the migration approach.
2. **Pilot mailbox: cloud.ops@tekprocloud.com**, a new address rather than cutting over cloud.support@tekkonnectpro.com immediately. This lets the pilot run in parallel with the existing Freshdesk mailbox without disrupting live client email while Cloud Ops Tool is being validated. Cutover of the original mailbox happens once the pilot period is over and Freshdesk is being fully retired for tenant zero.
3. **Initial agents for tenant zero's Cloud Support group:** Vincent D'Souza, Srinath Sreedharan, Ruthvik M, Sohel S, Sparsh, Manoj K. These six get seeded as the initial `agents` rows in Sprint 1, all assigned to the single "Cloud Support" group to start, matching the current Freshdesk structure. Per-agent role (admin vs agent) and any sub-grouping by specialty (Azure vs AWS vs general) can be refined after the pilot mailbox is live, not before.

## 9. Freshdesk Migration Plan

Since migration is confirmed in scope, here's the approach, to be executed in Sprint 5 (Hardening and cutover) once the Ticketing module itself is stable:

- **Export path:** pull tickets out via the Freshdesk API (`GET /api/v2/tickets` with `include=conversations`), not a manual CSV export, so replies, notes, and attachments come across intact rather than just ticket metadata. Freshdesk's API is rate limited, so this runs as a background job that paginates through the full ticket history rather than a single blocking call.
- **Field mapping:** Freshdesk's `type` maps to `ticket_type_id` (create matching `ticket_types` rows first, e.g. "Cloud Support - Azure" as seen in the current account), `group` maps to `group_id`, `responder_id` maps to `agent_id` (matched against the six seeded agents by email), `requester` maps to `contact_id` (create the contact if it doesn't already exist from a prior ticket).
- **Attachments:** pulled from Freshdesk's attachment URLs and re-uploaded to Cloud Ops Tool's own object storage rather than linking back to Freshdesk, since Freshdesk access won't be guaranteed to persist after cutover.
- **What doesn't migrate:** Freshdesk-specific automation rule definitions and canned responses don't port over automatically, since the underlying rule engines aren't compatible. These get manually recreated as part of Sprint 3 (they're a small, known list for a team this size, not worth building a translator for).
- **Ticket numbering:** migrated tickets keep a reference to their original Freshdesk ticket number in a `legacy_ticket_number` field (add this column to the `tickets` table) so old references, emails, and links from before the cutover still resolve to the right ticket, even though the tenant's new sequential numbering starts fresh alongside the migrated ones.
- **Validation:** spot check a sample of migrated tickets against the live Freshdesk account (message count, attachment count, SLA due dates) before Freshdesk is fully retired for tenant zero, and keep the Freshdesk account accessible (even if unused) for a period after cutover as a fallback reference.
