# Deploying to an Oracle Cloud VM with Docker

Assumes: the Oracle Cloud compute instance already exists (Ubuntu or Oracle
Linux, reachable over SSH with a public IP), and you own a domain you can
point DNS records at. This deploys the whole stack — Postgres, Redis, the
API, the agent web app, and the customer portal — as Docker containers on
that one VM, with Caddy handling HTTPS automatically via Let's Encrypt.

**One thing to know going in:** the Dockerfiles, compose file, and Caddy
config below were written and syntax-validated (`docker compose config`),
but couldn't be built and run end-to-end in the environment they were
authored in — its network policy blocks pulling from Docker Hub. This is the
first time this exact packaging gets a real build. Follow the verification
steps after `docker compose up` closely, and see Troubleshooting at the
bottom if something doesn't come up clean. Strongly consider the next
section first — it catches the same class of issue in a couple of minutes,
without needing DNS or the VM at all.

## 0. Testing locally first (recommended)

`docker-compose.local.yml` runs the exact same `api`/`web`/`portal` images
on `localhost` with plain HTTP — no domain, no TLS, no VM. Do this before
touching the actual VM; if something's wrong with the build, you'll find out
here in a couple of minutes instead of after DNS propagation.

```bash
git clone <your repo URL> cloud-ops-tool && cd cloud-ops-tool
cp .env.local.example .env
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml \
  up -d --build postgres redis api web portal
docker compose -f docker-compose.prod.yml -f docker-compose.local.yml logs -f
```

(Caddy is deliberately left out of that service list — it wants to bind 80/443
and isn't needed for this, since the override publishes web/portal/api
directly.) Same thing to watch for as production: Postgres healthy, then the
`api` container running migrations, then `Nest application successfully
started`. Once it's up:

- `http://localhost:3000/api/v1/tickets` with header `X-Tenant-Id:
  00000000-0000-0000-0000-000000000000` → expect a 401, confirms the API is
  actually serving
- `docker compose -f docker-compose.prod.yml -f docker-compose.local.yml
  exec postgres psql -U postgres -d cloud_ops_tool -c "SELECT id, name FROM
  tenants;"` → copy the seeded tenant's id
- `http://localhost:8080` (agent app) — paste that tenant id in, or log in as
  one of the six seeded agents with `ChangeMe123!`
- `http://localhost:8081` (portal) — paste the same tenant id, browse/submit
  a ticket

Tear it down when done: `docker compose -f docker-compose.prod.yml -f
docker-compose.local.yml down -v` (the `-v` also deletes the local test
data/volumes — safe here since none of this is real data).

Once this works, the only things that differ for the real VM are DNS,
firewall rules, and using `docker-compose.prod.yml` alone (no `.local`
override) so Caddy handles real domains and HTTPS instead of plain
localhost ports.

## 1. Point DNS at the VM

Pick three subdomains (or however you want to split it up) and create `A`
records pointing at the VM's public IP, e.g.:

```
app.example.com     -> <vm public ip>   (agent app)
portal.example.com  -> <vm public ip>   (customer portal)
api.example.com     -> <vm public ip>   (API)
```

DNS propagation can take a few minutes. Caddy requests a Let's Encrypt
certificate for each domain the first time it starts, which requires the
domain to already resolve to this VM and port 80 to be reachable from the
internet — start this now so it's ready by the time you get to step 6.

## 2. Open the required ports

Oracle Cloud VMs are behind **two** separate firewalls — both need to allow
the traffic, not just one:

**a) The VM's own firewall** (`iptables`/`firewalld`, varies by image). On
Ubuntu:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable    # if not already enabled
```

On Oracle Linux (uses firewalld):

```bash
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --reload
```

**b) The instance's Security List / Network Security Group**, in the Oracle
Cloud console: Compute → your instance → the attached VCN's subnet →
Security Lists (or NSGs, if the instance uses one). Add ingress rules for
TCP 80 and TCP 443 from `0.0.0.0/0`. This is the step people most often
forget — the OS firewall being open doesn't matter if the cloud-level list
still blocks the port.

Do **not** open 5432 (Postgres) or 6379 (Redis) — the compose file below
doesn't publish those ports to the host at all, so there's nothing to lock
down there.

## 3. Install Docker

SSH into the VM, then:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker          # or log out and back in
docker --version
docker compose version
```

## 4. Get the code onto the VM

```bash
git clone <your repo URL> cloud-ops-tool
cd cloud-ops-tool
```

(If you're deploying via the git-bundle workflow instead of a normal clone,
apply the bundle locally first, push it to your actual git remote, then
clone that remote here — don't try to copy bundles onto the VM directly.)

## 5. Configure environment

```bash
cp .env.prod.example .env
```

Edit `.env` and fill in:

- `APP_DOMAIN`, `PORTAL_DOMAIN`, `API_DOMAIN` — the three domains from step 1
- `ACME_EMAIL` — your email, for Let's Encrypt renewal notices
- `DB_MIGRATOR_PASSWORD`, `DB_APP_PASSWORD` — two different strong passwords:
  ```bash
  openssl rand -base64 32
  ```
- `JWT_SECRET`, `INTERNAL_API_KEY` — same command:
  ```bash
  openssl rand -base64 48
  ```

Leave everything under "Optional" alone for now — SMTP, email intake,
OAuth, and Freshdesk migration can all be configured later without
rebuilding anything.

## 6. Build and start the stack

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

This builds five images (api, web, portal, plus pulls postgres/redis/caddy)
and starts everything. First build will take a few minutes. Watch it come
up:

```bash
docker compose -f docker-compose.prod.yml logs -f
```

You're looking for, in order: Postgres reporting healthy, then the `api`
container logging `Running database migrations...` followed by each
migration name, then `Starting API...` and finally `Nest application
successfully started`. Ctrl-C out of the logs once you see that (the stack
keeps running in the background either way, `-d` already detached it).

## 7. Verify

```bash
# API health
curl -s https://api.example.com/api/v1/tickets -H "X-Tenant-Id: 00000000-0000-0000-0000-000000000000"
# expect a 401 (invalid tenant) -- confirms the API is reachable and Caddy's cert is valid, not a connection error

docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -d cloud_ops_tool -c "SELECT id, name FROM tenants;"
```

That second command lists the tenant seeded by the migrations — "Tekpro /
MadVR (internal)" — copy its `id`. Visit `https://app.example.com`, paste
that id into the X-Tenant-Id field, and you should see an empty ticket list.

Six agents were seeded by the same migrations, all sharing one temporary
password: **`ChangeMe123!`**. Their emails are in
`apps/api/src/database/migrations/*SeedTenantZeroAndAgents.ts` /
`*CorrectAgentEmails.ts` if you need to look them up. Log in as one from the
web app's header. **Rotate this password** once real login is actually in
use — it's a shared, source-controlled bootstrap value, not meant to be
long-lived. There's no self-service change-password flow yet; for now, set a
new one directly:

```bash
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -d cloud_ops_tool -c \
  "UPDATE users SET password_hash = crypt('<new password>', gen_salt('bf')) WHERE email = '<agent email>';"
```

Optionally, set `DEFAULT_TENANT_ID` in `.env` to that tenant id and
re-deploy the portal (`docker compose -f docker-compose.prod.yml up -d
--build portal`) so portal visitors don't need to paste it manually — see
"Redeploying" below.

## Redeploying after a code change

```bash
cd cloud-ops-tool
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Compose only rebuilds images whose inputs changed, so this is safe to run
even when only one app changed. Migrations run automatically on every `api`
container start (see `apps/api/entrypoint.sh`) and are idempotent, so
there's no separate migration step to remember.

## Common operations

```bash
# Tail one service's logs
docker compose -f docker-compose.prod.yml logs -f api

# Restart one service without rebuilding
docker compose -f docker-compose.prod.yml restart api

# Back up Postgres
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U postgres cloud_ops_tool > backup-$(date +%F).sql

# Run the one-time Freshdesk migration (after setting FRESHDESK_DOMAIN /
# FRESHDESK_API_KEY / MIGRATION_TENANT_ID in .env and redeploying api)
docker compose -f docker-compose.prod.yml exec api pnpm migrate:freshdesk

# Stop everything (data volumes persist)
docker compose -f docker-compose.prod.yml down

# Stop everything AND delete all data -- careful
docker compose -f docker-compose.prod.yml down -v
```

## Troubleshooting

**Caddy won't get a certificate / `docker compose logs caddy` shows ACME
errors.** Almost always DNS or the port-80 firewall rule. Confirm the domain
actually resolves to the VM (`dig +short app.example.com` from your own
machine) and that port 80 is reachable from the public internet (not just
from inside the VM) — check both firewall layers from step 2 again.

**`api` container keeps restarting / logs show a migration error.** Check
`docker compose -f docker-compose.prod.yml logs api`. If it's a Postgres
connection error, confirm `postgres` is healthy
(`docker compose -f docker-compose.prod.yml ps`) and that
`DB_MIGRATOR_PASSWORD` matches between what Postgres was initialized with
and what's in `.env` (changing the password in `.env` after the `postgres`
volume already exists doesn't retroactively change it — you'd need to
change it inside Postgres directly, or wipe the volume on a fresh install
only). If it's `ts-node: command not found` or similar, the `pnpm deploy`
step in `apps/api/Dockerfile` didn't carry devDependencies through the way
it does in the sandbox this was built in — check `docker compose exec api
ls node_modules/.bin | grep ts-node`, and if it's missing, remove `--prod`
if it was accidentally reintroduced, or fall back to running migrations
from a full `pnpm install` inside the container as a workaround while
filing the packaging issue.

**Browser shows a CORS error.** `CORS_ORIGIN` on the `api` service must
exactly match the scheme + domain the browser is actually loading the app
from (`https://app.example.com`, not `http://` or a bare IP). It's derived
automatically from `APP_DOMAIN`/`PORTAL_DOMAIN` in `.env` — double-check
those are set correctly and redeploy `api` if you change them.

**Attachments uploaded before a redeploy are gone.** They're stored in the
`attachments_data` named volume, which survives `docker compose up
--build` and `restart`, but not `down -v`. If they're actually missing
after a normal redeploy, check `docker volume ls` for
`cloud-ops-tool_attachments_data` and confirm the `api` service's volume
mount in `docker-compose.prod.yml` still points at it.
