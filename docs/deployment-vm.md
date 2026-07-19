# Deploying Cloud Ops Tool on a single Linux VM

The whole stack — Postgres, Redis, the API, the agent app, and the customer
portal — runs as Docker containers on one Linux VM, with **Caddy** terminating
HTTPS automatically via Let's Encrypt. Plan on 20–30 minutes end to end.

This is the provider-agnostic version of the runbook. For an Oracle Cloud
walkthrough (with the two-firewall specifics), see
[`deployment-oracle-cloud.md`](./deployment-oracle-cloud.md).

## Overview & stack

Everything is orchestrated by `docker-compose.prod.yml` in the repo root. You
edit one `.env` file, run one `docker compose up`, and Caddy handles
certificates for three subdomains. Database migrations run automatically each
time the API container starts (`apps/api/entrypoint.sh`), so there's no
separate migration step to remember.

```
Browser  ──443/80──▶  Caddy (auto-HTTPS reverse proxy)
                          │  routes by hostname
                 ┌────────┼────────┐
                 ▼        ▼        ▼
                web     portal     api
          app.ex.com  portal.ex  api.ex.com
                                   │  internal network only
                            ┌──────┴──────┐
                            ▼             ▼
                      Postgres 16      Redis 7
                    (not published)  (not published)
```

| | |
|---|---|
| Public ports | 80 & 443 **only** |
| Data ports | 5432 / 6379 **never exposed** |
| TLS | Caddy → Let's Encrypt |
| Migrations | automatic on `api` start |

## Prerequisites

- A Linux VM (Ubuntu 22.04+ or similar) reachable over SSH with a **public
  IP**. 2 vCPU / 4 GB RAM is a comfortable starting point.
- A **domain** you can add DNS records to.
- Your repo's clone URL.

> **Recommended:** do a full local dry run first with the
> `docker-compose.local.yml` override — same images, plain HTTP on
> `localhost`, no DNS or TLS. If the build has a problem you'll find out in two
> minutes instead of after DNS propagates. See [Test locally
> first](#appendix--test-locally-first).

---

## 1. Point DNS at the VM

Create three `A` records — one per app — all pointing at the VM's public IP:

```
app.example.com     A   <vm-public-ip>   # agent app
portal.example.com  A   <vm-public-ip>   # customer portal
api.example.com     A   <vm-public-ip>   # API
```

Start this now — Caddy can only issue a certificate once each name resolves to
this VM and port 80 is publicly reachable. Propagation can take a few minutes.

## 2. Open firewall ports

Only **22, 80, and 443** need to be open. On Ubuntu:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

> **Cloud provider gotcha:** most cloud VMs sit behind a **second** firewall in
> the provider console (AWS Security Group, GCP firewall rule, Oracle Security
> List / NSG). The OS firewall being open doesn't matter if the cloud layer
> still blocks the port. Add ingress rules for TCP 80 and 443 from `0.0.0.0/0`
> there too — this is the most commonly missed step.

Do **not** open 5432 or 6379 — the compose file never publishes Postgres or
Redis to the host, so there is nothing to expose.

## 3. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker          # or log out and back in
docker compose version  # confirm the plugin is present
```

## 4. Get the code onto the VM

```bash
git clone <your-repo-url> cloud-ops-tool
cd cloud-ops-tool
```

## 5. Configure secrets

Copy the template to `.env` (compose reads it automatically — it must sit next
to `docker-compose.prod.yml`):

```bash
cp .env.prod.example .env
```

Fill in the required values:

- `APP_DOMAIN`, `PORTAL_DOMAIN`, `API_DOMAIN` — the three names from step 1.
- `ACME_EMAIL` — your email, for Let's Encrypt renewal notices.
- `DB_MIGRATOR_PASSWORD`, `DB_APP_PASSWORD` — two *different* strong values.
- `JWT_SECRET`, `INTERNAL_API_KEY` — signing / service secrets.

```bash
openssl rand -base64 32   # each DB password
openssl rand -base64 48   # JWT_SECRET, INTERNAL_API_KEY, encryption key
```

> **⚠️ Important — encryption key.** `CREDENTIALS_ENCRYPTION_KEY` encrypts
> every secret stored at rest — cloud-provider credentials, SNMP community
> strings, MFA/TOTP secrets. If you leave it unset in `.env`, the app falls
> back to a known, source-controlled dev key, which is effectively no
> encryption. Set a real value before deploying for real:
>
> ```bash
> CREDENTIALS_ENCRYPTION_KEY=<paste a fresh `openssl rand -base64 48`>
> ```
>
> **Never rotate this in place.** Set it **once, before first launch**.
> Changing it after secrets are stored makes existing ciphertext
> undecryptable. If you've already stored cloud/SNMP/MFA secrets under the
> dev default, re-enter them after setting a real key.

Everything under "Optional" in the template — SMTP, email intake, OAuth,
Freshdesk migration, and the ingest rate-limit tuning
(`INGEST_MAX_REQUESTS_PER_WINDOW` / `INGEST_RATE_WINDOW_SECONDS`, which have
safe defaults) — can be left alone and configured later without a rebuild.

## 6. Build & start the stack

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f
```

The first build takes a few minutes. In the logs, watch for this order:

1. Postgres reports **healthy**.
2. The `api` container logs `Running database migrations…` then each migration
   name.
3. `Starting API…` → `Nest application successfully started`.

Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to stop tailing — the stack stays up (it's
detached via `-d`).

## 7. Verify

```bash
curl -s https://api.example.com/api/v1/tickets \
  -H "X-Tenant-Id: 00000000-0000-0000-0000-000000000000"
```

**Expected:** a `401` response. That confirms the API is reachable *and*
Caddy's certificate is valid — a connection or TLS error would look completely
different. (401 just means the tenant id isn't a real one yet.)

Now grab the tenant seeded by the migrations:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U postgres -d cloud_ops_tool -c "SELECT id, name FROM tenants;"
```

Copy the `id` of the seeded tenant ("Tekpro / MadVR (internal)"), open
`https://app.example.com`, paste it into the **X-Tenant-Id** field, and you
should see an empty ticket list.

## 8. First login & rotate the seed password

The migrations seed six agents that all share one bootstrap password:
`ChangeMe123!`. Their emails are in the `*SeedTenantZeroAndAgents.ts` /
`*CorrectAgentEmails.ts` migrations. Log in as one from the web app header.

> **Rotate immediately.** `ChangeMe123!` is a shared, source-controlled value
> — not meant to outlive setup. There's no self-service password change yet, so
> set a new one directly:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U postgres -d cloud_ops_tool -c \
  "UPDATE users SET password_hash = crypt('<new-password>', gen_salt('bf')) \
   WHERE email = '<agent-email>';"
```

Optionally set `DEFAULT_TENANT_ID` in `.env` to that tenant id and redeploy the
portal, so visitors never have to paste it.

---

## Redeploying after a code change

```bash
cd cloud-ops-tool && git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Compose only rebuilds images whose inputs changed, and migrations run
automatically and idempotently on each `api` start — so this one command is the
whole redeploy.

## Common operations

```bash
# Tail one service
docker compose -f docker-compose.prod.yml logs -f api

# Restart one service without rebuilding
docker compose -f docker-compose.prod.yml restart api

# Back up Postgres
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U postgres cloud_ops_tool > backup-$(date +%F).sql

# Stop everything (named volumes and data persist)
docker compose -f docker-compose.prod.yml down
```

> **Destructive:** `docker compose -f docker-compose.prod.yml down -v` also
> deletes every named volume — Postgres data, Redis, and uploaded attachments.
> There is no undo. Only use `-v` on a throwaway environment.

## Troubleshooting

**Caddy won't get a certificate.** Almost always DNS or the port-80 rule.
Confirm the name resolves to the VM (`dig +short app.example.com` from your own
machine) and that port 80 is reachable from the public internet — re-check
*both* firewall layers from step 2.

**The `api` container keeps restarting.** Check
`docker compose -f docker-compose.prod.yml logs api`. If it's a Postgres
connection error, confirm `postgres` is healthy and that `DB_MIGRATOR_PASSWORD`
matches what Postgres was first initialised with — changing it in `.env` after
the volume exists doesn't retroactively change it inside Postgres.

**Browser shows a CORS error.** `CORS_ORIGIN` is derived from `APP_DOMAIN` /
`PORTAL_DOMAIN` and must exactly match the scheme+host the browser loads
(`https://app.example.com`, not `http://` or a bare IP). Fix those in `.env`
and redeploy `api`.

**RUM beacons rejected.** The `/rum/collect` endpoint is intentionally
open-CORS but rate-limited per app key. A flood of `429`s means a client is
exceeding `INGEST_MAX_REQUESTS_PER_WINDOW` (default 300 / 60s) — raise it in
`.env` if legitimate traffic is higher, then redeploy `api`.

**Attachments vanished after a redeploy.** They live in the `attachments_data`
named volume, which survives `up --build` and `restart` but not `down -v`.
Confirm the volume still exists with `docker volume ls`.

## Appendix — test locally first

The `docker-compose.local.yml` override runs the identical images on
`localhost` over plain HTTP — no domain, no TLS, no VM. It's the fastest way to
catch a build problem.

```bash
cp .env.local.example .env
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml \
  up -d --build postgres redis api web portal
```

Then: agent app on `http://localhost:8080`, portal on `http://localhost:8081`,
API on `http://localhost:3000`. Log in with a seeded agent and `ChangeMe123!`.
Tear down with `down -v` — the local data is disposable.

> Caddy is deliberately excluded from that service list — it wants ports 80/443
> and isn't needed locally, since the override publishes web/portal/api
> directly.
