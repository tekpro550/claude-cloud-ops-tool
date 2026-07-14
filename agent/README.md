# cloud-ops-tool server agent

Small long-running process that reports CPU/memory/disk usage to the API on
an interval, for servers that can't be checked by an external http/ping/port
probe (Module 2 Sprint 3 -- see
`docs/Cloud-Ops-Tool-Module2-Monitoring-Scope.md`). No third-party
dependencies: metrics come from `/proc` on Linux, HTTP from `net/http`.

## Build

```bash
cd agent
go build -o cloud-ops-agent .
```

## Get a device token

From the API, as an authenticated agent (`X-Tenant-Id` or Bearer):

```bash
curl -X POST https://api.example.com/api/v1/agent-tokens \
  -H "X-Tenant-Id: <tenant id>" \
  -H "Content-Type: application/json" \
  -d '{"resourceId": "<resource id>", "label": "prod-db-01"}'
```

The response's `token` field is shown once -- it's a long-lived signed JWT,
not stored raw server-side, so there's nothing to retrieve later if it's
lost. If that happens, create a new token and revoke the old one
(`PATCH /agent-tokens/:id { "isEnabled": false }`).

To actually get alerts out of the reported metrics, also create a
`server_agent` monitor on the same resource and an `alert_rule` for it (see
the Sprint 2 alerting API) -- the token alone only keeps
`agent_tokens.last_seen_at` fresh.

## Run

```bash
AGENT_API_BASE_URL=https://api.example.com/api/v1 \
AGENT_TOKEN=<token from above> \
./cloud-ops-agent
```

| Env var | Default | |
|---|---|---|
| `AGENT_API_BASE_URL` | *required* | Base URL including `/api/v1` |
| `AGENT_TOKEN` | *required* | The device token from `/agent-tokens` |
| `AGENT_REPORT_INTERVAL_SECONDS` | `60` | How often to POST `/agent/report` |
| `AGENT_DISK_PATH` | `/` | Filesystem to measure disk usage on |
| `AGENT_CPU_SAMPLE_WINDOW_SECONDS` | `1` | Sampling window for the CPU percent calculation |

If metrics collection fails entirely on a given tick (not expected on
Linux, but e.g. a permissions issue), the agent still calls
`/agent/heartbeat` so a metrics bug doesn't get mistaken for the server
being genuinely unreachable.
