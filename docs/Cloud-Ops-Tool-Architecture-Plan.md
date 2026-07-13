# Cloud Ops Tool
## Unified Architecture and Build Plan
### Combining Freshdesk (helpdesk), Site24x7 (monitoring), and CloudHealth/CloudSpend style tools (FinOps) into one platform

Prepared for: Vincent A D'Souza, Tekpro
Status: Draft for review. Nothing gets built until this is approved.

---

## 1. What This Product Actually Is

Cloud Ops Tool is not three products bolted together. The real opportunity, and the reason a unified build beats using three separate SaaS tools, is that these three categories all sit on the same underlying object: **a customer's infrastructure and the events happening on it.**

- Site24x7 tells you something broke.
- Freshdesk tells you who is handling it.
- CloudHealth tells you what it costs.

Today those live in three logins with three billing relationships and zero shared context. The single biggest differentiator for Cloud Ops Tool is closing that loop: an alert becomes a ticket automatically, the ticket shows the cost trend of the resource that triggered it, and resolving the ticket can trigger a cost optimization action. None of Freshdesk, Site24x7, or the FinOps tools do this today because they are separate companies with separate roadmaps.

Given your answers, the target shape is:
- Multi tenant SaaS from day one, hosted on your own infrastructure
- Built first for Tekpro's and MadVR's own internal ops (helpdesk for client support, monitoring for Ginger/Tittu infra, cost tracking for your own cloud bills)
- Designed from the start so tenant 2, 3, and 4 can be onboarded as paying customers without a rebuild

---

## 2. Research Findings and What They Mean for the Build

I pulled current (2026) product and review data on all three categories before proposing anything. Key findings and how they shape the plan:

**Freshdesk**
Its core is unified ticketing across email, chat, phone, and social with automation rules (Dispatch'r, Supervisor, Observer) and Freddy AI for suggested replies and summarization. The most consistent complaint across reviews is pricing fragmentation: core ticketing is one subscription, the Omni (chat plus phone) bundle is a separate and pricier subscription, and AI features are metered separately again. Customers frequently end up managing multiple bills for what feels like one product.
Implication: Cloud Ops Tool should sell one plan per tenant tier, not a matrix of add ons. Channels (email, chat, WhatsApp via Tittu) should be included, not upsold separately.

**Site24x7**
Strong all in one coverage: uptime, server, APM, network, log, and cloud monitoring in one dashboard, with AIOps style anomaly detection. The most repeated complaint is interface overwhelm and alert fatigue once monitoring scope grows, plus a pricing model that adds separate charges per host, per log GB, and per RUM pageview, making the bill unpredictable.
Implication: Ship monitoring with sane default alert thresholds and alert grouping/deduplication from day one, not as a later feature. Price monitoring by a simple tier (hosts plus data volume band), not itemized add ons.

**FinOps tools (CloudHealth, Cloudability, CloudZero, Vantage, and peers)**
Two tool shapes exist. Governance platforms like CloudHealth are strong on policy, guardrails, and rightsizing recommendations, but are described repeatedly as heavy to set up and requiring real FinOps expertise. Lighter tools like CloudZero and Vantage focus on visibility and unit economics with faster time to value. Pricing across this category is often a percentage of monitored cloud spend (roughly 0.25 to 3 percent), which is opaque to a customer trying to budget.
Implication: Cloud Ops Tool's cost module should default to the lightweight visibility experience (fast setup, clear dashboards) and treat governance/policy automation as a Phase 2 layer once the visibility layer is proven. Price cost management flatly per connected cloud account, not as a percentage of spend, since percentage pricing is a recurring source of customer distrust in this category.

**Cross cutting pattern**
Every one of these tools, in every review, gets criticized for the same three things at scale: pricing that fragments as usage grows, alert or notification overload, and setup complexity. Those three complaints are your product brief. If Cloud Ops Tool solves those three things better than the incumbents, it does not need every feature they have to be worth switching to.

---

## 3. Suggested Changes and Differentiators (based on the above research)

These are recommended departures from copying the incumbents feature for feature:

1. **One tenant, one price.** A tenant picks a tier (Starter, Growth, Scale). Ticketing, monitoring, and cost visibility are all included at that tier's usage caps. No separate Omni style upsell, no per GB log surprise, no percentage of cloud spend fee.
2. **Alert to ticket to cost, natively linked.** A monitoring alert on a resource auto creates a ticket. That ticket surfaces the last 30 days of cost for that resource inline. When the ticket is resolved as "rightsized" or "terminated", the cost module logs the expected saving and tracks whether it materialized. This closes a loop none of the three source products close.
3. **Notification channels via your own stack.** Instead of building yet another email/SMS notification pipe, route critical alerts through Tittu (WhatsApp) and Ginger (voice call for P1 incidents) since you already operate both. This is a real, defensible differentiator: nobody else can call a customer's on call engineer with an AI voice agent reading out an incident summary.
4. **Default alert grouping and noise suppression on day one.** Site24x7's biggest complaint is alert fatigue. Cloud Ops Tool should deduplicate and group related alerts (same resource, same root cause window) before they hit a human, not after.
5. **Cost visibility before cost governance.** Ship dashboards and anomaly detection first. Policy engines, auto termination rules, and guardrails come in Phase 2 once tenants trust the numbers.
6. **Single data model across modules.** A "resource" (a server, a cloud account, a service) is one entity referenced by the monitoring module, the cost module, and the ticketing module. This is the architectural choice that makes point 2 possible and is the main reason to build this as one product instead of stitching three SaaS tools with Zapier.

---

## 4. High Level Architecture

```
                          ┌─────────────────────────────┐
                          │        Web App (React)        │
                          │  Tickets | Monitoring | Cost   │
                          └───────────────┬─────────────┘
                                          │  HTTPS / WebSocket
                          ┌───────────────▼─────────────┐
                          │        API Gateway / BFF      │
                          │  Auth, rate limit, routing     │
                          └───────────────┬─────────────┘
             ┌─────────────────┬──────────┴───────┬──────────────────┐
             ▼                 ▼                  ▼                  ▼
   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
   │  Ticketing    │   │  Monitoring   │   │  Cost/FinOps  │   │  Platform     │
   │  Service      │   │  Service      │   │  Service      │   │  Services     │
   │ (tickets,SLA, │   │ (checks,alerts│   │ (billing sync,│   │ (auth, tenant,│
   │  automation)  │   │  metrics)     │   │  anomalies)   │   │  notif, audit)│
   └──────┬────────┘   └──────┬────────┘   └──────┬────────┘   └──────┬────────┘
          │                   │                    │                   │
          └───────────────────┴─────────┬──────────┴───────────────────┘
                                         ▼
                          ┌─────────────────────────────┐
                          │        Event Bus (Kafka/     │
                          │        Redis Streams)         │
                          │  alert.created, cost.anomaly, │
                          │  ticket.resolved               │
                          └───────────────┬─────────────┘
                                          │
              ┌───────────────┬──────────┴────────┬───────────────────┐
              ▼               ▼                   ▼                   ▼
     ┌────────────┐  ┌────────────┐      ┌────────────┐      ┌────────────┐
     │ PostgreSQL  │  │ TimescaleDB │      │ ClickHouse  │      │  S3/Blob    │
     │ (tenants,   │  │ (metrics,   │      │ (cost line   │      │ (logs,      │
     │  tickets,   │  │  uptime     │      │  items,      │      │  attachments│
     │  users)     │  │  checks)    │      │  large scans)│      │  reports)   │
     └────────────┘  └────────────┘      └────────────┘      └────────────┘

  External connectors: AWS/Azure/GCP billing + monitoring APIs, agent binaries on
  customer servers, email/SMTP, Tittu WhatsApp API, Ginger Voice AI API
```

Why a modular monolith to start, not full microservices: with one internal tenant and a small handful of early customers, four independently deployable services (Ticketing, Monitoring, Cost, Platform) sharing one event bus gives you the separation you need for the "linked loop" differentiator without the operational overhead of a full microservices mesh on day one. Split further only when a specific module's load actually demands it (monitoring ingestion is the most likely first candidate, since metrics volume grows faster than ticket volume).

---

## 5. Multi Tenancy Strategy

Since this is multi tenant SaaS from day one:

- **Isolation model:** Shared database, shared schema, with a `tenant_id` column on every table and Postgres Row Level Security (RLS) enforcing tenant isolation at the database layer, not just in application code. This is the standard, proven approach for SaaS at your expected scale (tens to low hundreds of tenants in year one) and is far cheaper to operate than database-per-tenant.
- **Escape hatch for later:** Design the data layer so a specific large or compliance sensitive tenant (say, a BFSI client of Tekpro's) can be moved to a dedicated schema or dedicated database without an application rewrite. Keep tenant_id as the partition key everywhere so this migration is mechanical, not architectural surgery.
- **Your own tenant:** Tekpro/MadVR internal ops is tenant zero. It exercises every module in production before a single external customer sees the product, which is the right order of operations you already asked for.

---

## 6. Recommended Tech Stack

You said no preference, so here is what best fits the requirements (multi tenant SaaS, real time monitoring ingestion, ticket workflows, cost data aggregation, and reuse of what your team already knows from the Ginger Studio build):

| Layer | Recommendation | Why |
|---|---|---|
| Frontend | React + TypeScript, Tailwind | Matches your existing Ginger Voice AI Agent Studio stack and frontend design skill approach; your team already has working muscle memory here |
| Backend API | Node.js with NestJS (TypeScript) | Structured, testable, good for a modular monolith with clear module boundaries; same language as frontend reduces context switching for a small team |
| Monitoring agent (runs on customer servers) | Go | Small static binaries, cross platform, low resource footprint; this is what Site24x7 and most serious monitoring agents use for the same reasons |
| Primary database | PostgreSQL | Row Level Security for tenant isolation, mature, well understood |
| Time series data (uptime checks, server metrics) | TimescaleDB (Postgres extension) | Avoids introducing a second database technology just for metrics; scales to millions of data points per day comfortably at your expected size |
| High volume analytics (cost line items, log search) | ClickHouse | Purpose built for the kind of "millions of rows, aggregate fast" queries that cost reporting and log search both need |
| Cache and job queues | Redis + BullMQ | Handles background jobs (billing sync, alert evaluation, notification dispatch) without adding Kafka's operational weight in year one |
| Event bus | Redis Streams initially, Kafka if/when volume demands it | Redis Streams is enough for the "alert to ticket to cost" event pattern at tenant zero and early customer scale |
| Auth | Custom JWT + OAuth2, with SSO/SAML added in Phase 2 | Enterprise clients will eventually want SSO; build the user/tenant model so it slots in later without a rewrite |
| Infrastructure | Docker plus Kubernetes (managed, e.g. a single managed K8s cluster) | Since you chose hosted multi tenant SaaS, K8s gives you the room to scale specific services (monitoring ingestion especially) independently later |
| IaC | Terraform | Standard, keeps your infra reproducible and auditable |
| Object storage | S3 compatible (AWS S3 or a cheaper compatible provider) | Attachments, generated reports, log archives |
| Notifications | SendGrid/SES for email, Tittu API for WhatsApp, Ginger API for voice escalation | Reuses assets you already operate instead of building a third notification pipeline from scratch |

---

## 7. Core Modules

### 7.1 Ticketing Module (Freshdesk equivalent)
- Multi channel intake: email, web form, WhatsApp (via Tittu), chat widget
- Ticket lifecycle: statuses, priorities, custom fields, tags
- Automation rules engine: time based and event based triggers (equivalent to Freshdesk's Dispatch'r/Observer)
- SLA policies with escalation
- Agent collision detection
- Canned responses and a knowledge base for self service
- Auto ticket creation from monitoring alerts (the differentiator from section 3)
- Reporting: ticket volume, resolution time, CSAT
- **Human relative SLA framing, not raw timestamps.** Show "first response due in 5 hours" and "resolution overdue by a day" rather than just a due date. This is the same relative, plain language framing already used for the cost module's MTD pace alerts and the monitoring module's root cause text, and it should stay consistent across all three so the product feels like one thing, not three tools wearing the same skin.
- **A properties panel with Type, Status, Priority, Group, and Agent as the core editable fields** on every ticket, with "Type" acting as the categorization taxonomy (e.g. "Cloud Support, Azure") that ties a ticket back to the resource or service it concerns. This is also the field that should auto populate when a ticket is created from a monitoring alert.
- **A customizable side panel** (contact info, recent timeline, time logs, to do) that agents can reorder and toggle by frequency of use, rather than a fixed layout. Small feature, meaningfully better day to day ergonomics for agents who live in this screen for hours.
- **Per ticket to do checklist and time log**, separate from ticket status. Time logs matter specifically for Tekpro's managed services billing, since time spent per client ticket is the raw input for invoicing.
- **Dashboard as counters plus a trend graph, scoped by group.** Unresolved, overdue, due today, open, on hold, unassigned as the top row, a today versus yesterday hourly volume trend, and resolution/SLA percentage stats below. Same "fleet view first" principle as the monitoring and cost modules: this should be the default landing page for an agent or manager, not a report they have to go build.
- **A persistent, dismissible "needs attention" banner** at the top of the whole app (not scoped to one page) for things like a broken email integration or a contact needing review. This is a good pattern to generalize across all three modules: monitoring's configuration errors, cost's broken billing connections, and ticketing's integration issues should all be able to surface through the same top level banner mechanism.
- **Setup completeness indicators in admin** ("6 of 8 configured" with a checkmark) for each settings section. Cheap to build, meaningfully reduces the "did I finish onboarding this tenant" uncertainty, and doubles as an onboarding checklist for new tenants in Phase 2.
- Phase 2: AI agent for first line response, priced as included usage under the tenant's tier rather than metered per session, directly addressing the session credit pricing friction that shows up in Freshdesk's own AI Agent Studio today.

### 7.2 Monitoring Module (Site24x7 equivalent)
- Uptime and synthetic checks (HTTP, ping, port, DNS, SSL expiry) from your own probe locations initially, expandable later
- Server/infrastructure agent (Go binary) reporting CPU, memory, disk, process health
- Cloud resource monitoring via provider APIs (AWS, Azure, GCP) for the resources a tenant has connected
- Alert rules with thresholds, plus grouping/deduplication before dispatch (addressing the alert fatigue complaint directly)
- Status pages (public, per tenant, for their own customers if they resell)
- Escalation policies and on call schedules, integrated with the notification channels above
- **Client/group based monitor organization.** Every monitored resource belongs to a group (the MSP equivalent of the cost module's per account rollup), so one tenant's fleet view can be filtered or scoped by client name. This is the same shape as the cost module's account rollup and should share the same underlying grouping concept, not a separate one.
- **Fleet wide status view as the default landing page**, not a resource-by-resource click through. A single summary strip (total monitors, count by status: down, critical, trouble, up, plus confirmed anomalies and configuration errors) followed by the full monitor list with status icon, resource type tag, a relevant performance number, and last polled time. This is the page an ops person actually lives in day to day, so it should load fast and be the default view.
- **Auto generated root cause and reason text**, not just a threshold breach number. When a check fails, generate a plain sentence ("Disk utilization of / exceeds 80 percent", "Server shutdown or restart has been initiated") from the same threshold rule that fired, and show it prominently on the resource's summary page and in the alert itself. This is also exactly what gets attached to the auto created ticket from section 7.4.
- **Per resource dashboard structure:** a top KPI strip (availability percent, CPU, memory, disk, downtime count, SLA achieved), an events timeline (a colored horizontal bar showing down/critical/trouble/maintenance history at a glance), then detail tabs (CPU, memory, disks, network, processes, log query, checks, plugin integrations, notes/inventory). Build this as one reusable resource template, not a bespoke page per resource type, since the same shape works for a server, a database, or a cloud resource.
- **Manual outage entry.** Ops should be able to log a downtime event after the fact (a maintenance window that wasn't captured automatically, or a known incident) so the SLA and history record stays accurate even when the automated detection missed something.
- **Configuration error and suspended monitor accounting**, shown separately from the healthy fleet, same pattern as the cost module's broken billing integrations. A monitor whose agent stopped reporting needs its own visible bucket, not to just silently vanish from the healthy count.
- **Basic log query on collected logs**, with a simple filter syntax (by log type, time range) and a natural language query option layered on top once the underlying search works (Phase 2, this is the "Ask Zia" equivalent). Track log storage usage per tenant against their plan's included volume, and surface that usage on the page, not just on a billing invoice.
- **Plugin/integration marketplace with proactive suggestions.** Beyond the core checks, offer a library of specialized checks (process monitoring, service specific plugins, security insight scans) and, on a monitored resource's integration page, proactively suggest relevant unmonitored services with a one click "monitor now" action. This is a good adoption driver: it surfaces the next thing worth turning on instead of leaving the tenant to discover it.
- **Customizable notification templates** with variable substitution ($RESOURCE_NAME, $STATUS, $GROUP_NAME, $CHECK_TYPE), so a tenant can tune what an email, WhatsApp, or voice alert actually says without engineering involvement.

### 7.3 Cost/FinOps Module (CloudHealth/CloudSpend equivalent)
- Billing data ingestion from AWS Cost Explorer, Azure Cost Management, GCP Billing APIs
- Normalized multi cloud cost view (one dashboard, not three consoles)
- **Daily cost polling with month to date (MTD) alerting.** A scheduled job pulls each connected provider's spend once per day per tenant, and compares actual MTD spend against a pace adjusted expectation (spend so far divided by days elapsed, projected against days remaining), not a flat static threshold. This catches a cost spike on day 5 of the month, when raw MTD spend still looks small but the daily run rate has already broken budget.
  - Alert tiers: informational (trending 10 to 20 percent above pace), warning (20 to 40 percent above pace), critical (over 40 percent above pace or a hard budget cap breached)
  - Alerts route through the shared notification dispatcher from section 8, so a critical MTD breach can escalate to WhatsApp (Tittu) or a voice call (Ginger) the same way a P1 monitoring alert does
  - Per provider and consolidated multi cloud view of MTD spend, so a tenant sees both "AWS is over pace" and "total cloud spend is over pace" separately
- Cost allocation by tag, project, or team for showback
- Anomaly detection on spend (a resource or service that suddenly costs more, independent of the MTD pace check above, since a single resource spike can hide inside an otherwise on pace total)
- Rightsizing and idle resource recommendations, referencing live monitoring data from 7.2 (this is only possible because both modules share the same resource entity)
- Budget alerts and simple forecasting (end of month projected spend based on current pace)
- **MSP style multi account rollup view.** Since Tekpro's own use case is managing cloud spend across many client accounts, the primary cost dashboard should be a scrollable list of every connected account (not a single tenant's number), each card showing: previous month total, current MTD total with percent change, forecast for the month with percent change, a small monthly trend chart (last 6 to 7 months), and a "top spending by entity" breakdown (by subscription/linked account, by region, by service). This is the same shape CloudSpend itself uses and it maps directly onto how Tekpro already works, so it should be the default view, not a custom report someone has to build.
- **Auto generated plain language insight sentences per account.** Instead of just showing numbers, generate a one line narrative per account, for example "X's month to date spend is up Y percent, and forecasted to rise/drop by Z percent next month." This is cheap to generate from the same pace calculation in the MTD alerting logic above and makes the dashboard scannable without reading every chart.
- **Configuration error and suspended account handling.** Accounts where the billing API connection has broken (expired credentials, revoked access) need their own visible section, separate from active accounts, so a broken integration doesn't just silently stop reporting.
- Phase 2/3: extend "insights" beyond pure cost into basic cloud security posture checks (IAM roles with excessive privileges, security groups with unrestricted access, ineffective network ACL rules), tagging compliance, and unit economics reporting. This is a natural extension since the monitoring module already has read access into the same cloud accounts; it turns the cost module into a combined cost plus posture insights feed, which is where the CloudSpend product itself is headed, categorizing issues by Security, Availability, and Cost with severity levels
- Phase 2: policy driven automation (auto stop idle dev instances, enforce tagging)

### 7.4 Cross Module Integration Layer
This is the thin layer that makes points 2 and 3 of section 3 real:
- Event bus consumers that listen for `alert.created` and open a linked ticket with cost context attached
- A shared `resource` entity referenced by all three modules so "server X" means the same row everywhere
- A unified activity timeline per resource: alerts, tickets, and cost changes on one feed

---

## 8. Shared Platform Services

- **Identity and tenancy:** tenant provisioning, user invites, roles (admin, agent, viewer), RLS enforcement
- **Billing and subscription:** your own SaaS billing for tenants (Stripe or Razorpay, given Indian customers), tied to the one tier one price model from section 3. Surface plan usage against tier caps directly in the product (monitors used out of plan limit, log storage used out of plan limit, alert credits remaining), not just on an invoice, so a tenant sees they're approaching a cap before they hit a hard wall.
- **Notifications:** unified dispatcher fanning out to email, WhatsApp (Tittu), voice (Ginger), and in app
- **Audit log:** every state change (ticket edits, alert rule changes, cost policy changes) logged per tenant for compliance
- **Integrations hub:** a place to manage connected cloud accounts, Slack/Teams webhooks, and future third party connectors
- **Tenant level cost configuration:** financial year start month (not everyone runs January to December), and a toggle for whether Azure/reserved pricing should be shown at list price or at the tenant's actual negotiated/discounted rate. Both are small settings but matter a lot to whether the numbers on screen match what finance actually expects to pay.

---

## 9. Phased Roadmap

**Phase 0: Foundation (internal only)**
Tenant/auth/RLS scaffold, the shared resource entity, and the event bus wiring. No features yet, but the "one entity, three modules" architecture has to exist before any module is built or you end up rebuilding the ticketing and monitoring modules to bolt this on later.

**Phase 1: MVP for Tekpro/MadVR internal use**
Ticketing (core, no Omni-style channel gating), monitoring (uptime plus server agent for your own infra), cost module (AWS plus one other cloud you actually use). Alert-to-ticket linking live. This phase proves the differentiator works before anyone outside Tekpro sees it.

**Phase 2: Productize**
Multi tenant onboarding flow, billing/subscription, tiered plans, status pages, WhatsApp/voice notification channels wired to Tittu/Ginger, basic reporting dashboards.

**Phase 3: FinOps depth and governance**
Rightsizing automation, policy engine, budget forecasting, SSO/SAML for enterprise tenants, marketplace integrations.

---

## 10. Security and Compliance Notes
- RLS at the database layer, not just application level checks, given this is multi tenant from day one
- Secrets (cloud API credentials per tenant) encrypted at rest, never logged (this is directly relevant given the hardcoded credential root cause found in the Tittu WhatsApp platform audit; the same discipline applies here)
- Principle of least privilege for the cloud provider read only roles Cloud Ops Tool will ask each tenant to grant for billing and monitoring access
- Audit log is non negotiable given this touches both customer infrastructure access and billing data

---

## 11. Open Decisions Needing Your Approval Before Build Starts

1. Confirm the module build order in Phase 1 (recommended order above: ticketing and monitoring first since Tekpro needs those immediately for client support and Ginger/Tittu infra; cost module second since it depends on the resource entity existing first)
2. Confirm cloud providers to support first (recommend AWS and Azure first, since those cover your Tekpro client base; GCP in Phase 2)
3. Confirm hosting provider for Cloud Ops Tool's own infrastructure (AWS, Azure, or a cheaper Indian/managed K8s provider)
4. Confirm whether Tittu and Ginger APIs are ready to be called from a new internal service, or if that integration needs scoping with Vivian's team first

Once you approve this plan (or send back changes), tell me what to build first and I will scope that specific piece in detail: data models, API contracts, and a sprint by sprint build order.
