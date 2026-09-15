# MCP Toolshed

A standalone MCP aggregation layer for Render users. One endpoint, many tools — discovered via `search_tools`, governed by RBAC, backed by a code registry.

Agents connect to a single URL instead of configuring Render, GitHub, Slack, and custom MCP servers separately.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/render-examples/mcp-toolshed)

## Architecture

- **One Web Service** — gateway, search, and all provider adapters run in-process
- **One Postgres** — audit log and API key → role mapping (not the tool catalog)
- **Code registry** — approved tools and policy live in code and load at startup
- **One Cron Job** — bounded audit retention and interrupted-call reconciliation

```
Agent → POST /mcp → search_tools → get_tool_schema → tools/call → provider adapter
```

`tools/list` intentionally returns only meta-tools. Server instructions tell agents to use progressive discovery. Remote provider calls use fresh, stateless MCP clients; every resource scope must be supplied in the tool arguments.
The public `/mcp` endpoint uses MCP Streamable HTTP in stateless JSON-response
mode; protocol-level sessions are not persisted between requests.

---

## Setup guide

### Prerequisites

- **Node.js 22+**
- **Docker** (local Postgres only)
- **Render account** ([dashboard.render.com](https://dashboard.render.com))
- **Render CLI** (optional, for Blueprint deploy): `brew install render && render login`

### 1. Clone and configure

```bash
git clone https://github.com/render-examples/mcp-toolshed.git
cd mcp-toolshed
cp .env.example .env
```

Edit `.env` — at minimum set:

| Variable | Local value | Notes |
|----------|-------------|-------|
| `DATABASE_URL` | `postgresql://toolshed:toolshed@localhost:5433/toolshed` | Matches `docker-compose.yml` |
| `TOOLSHED_BOOTSTRAP_API_KEY` | any secret string | Becomes the initial admin key only when `api_keys` is empty |
| `RENDER_API_KEY` | your Render API key | Enables the Render provider |

Generate a production-grade key:

```bash
openssl rand -hex 32
```

### 2. Run locally

```bash
docker compose up -d postgres   # start Postgres on port 5433
npm install
npm run db:migrate              # applies migrations + inserts bootstrap key
npm run dev                     # http://localhost:3000
```

`npm run build` compiles the production application to `dist/`. The Docker
image runs that JavaScript directly; `tsx` is used only by local development
and maintenance scripts.

Verify:

```bash
curl http://localhost:3000/ready
# → {"status":"ok","toolCount":N}
```

If you have **no provider credentials** yet, add to `.env`:

```
TOOLSHED_ALLOW_EMPTY=true
```

### 3. Deploy to Render

The repo includes a Blueprint (`render.yaml`) that creates **one Web Service**, **one Postgres database**, and **one daily audit-cleanup Cron Job**.

#### Option A — Render CLI

```bash
render blueprint launch
```

Select your workspace and confirm resource creation when prompted.

#### Option B — Render Dashboard

1. Go to [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**
2. Connect the `render-examples/mcp-toolshed` repository
3. Review the three resources (`mcp-toolshed`, `toolshed-db`, `mcp-toolshed-audit-cleanup`) and apply

#### Secrets to set at deploy time

Render prompts for these (`sync: false` in `render.yaml`):

| Variable | Required | Purpose |
|----------|----------|---------|
| `TOOLSHED_BOOTSTRAP_API_KEY` | **Yes (first deploy)** | Admin API key; hashed into `api_keys` on migrate |
| `RENDER_API_KEY` | Recommended | Enables Render MCP tools (`render.*`) |
| `GITHUB_TOKEN` | Optional | Enables GitHub tools through GitHub's hosted MCP server (`github.*`) |
| `GITHUB_MCP_URL` | Optional | Defaults to `https://api.githubcopilot.com/mcp/` |
| `SLACK_BOT_TOKEN` | Optional | Slack bot token (`xoxb-...`) — see [Slack setup](#slack-setup) |
| `SLACK_TEAM_ID` | With Slack | Workspace ID (`T...`) — required with `SLACK_BOT_TOKEN` |
| `SLACK_CHANNEL_IDS` | Optional | Comma-separated channel IDs to limit access |
| `RENDER_MCP_URL` | Optional | Defaults to `https://mcp.render.com/mcp` |
| `TICKET_API_URL` / `TICKET_API_KEY` | Optional | Enables custom inline provider stub |
| `TOOLSHED_AUDIT_RETENTION_DAYS` | Optional | Audit retention; defaults to 30 days |
| `TOOLSHED_AUDIT_MAX_ARGUMENT_BYTES` | Optional | Maximum stored argument payload; defaults to 65536 bytes |
| `TOOLSHED_ALLOWED_ORIGINS` | Optional | Comma-separated browser origins allowed to call `/mcp`; requests with other origins are rejected |
| `TOOLSHED_ALLOWED_HOSTS` | With custom domains | Comma-separated custom hostnames accepted by `/mcp` |

**Health check note:** `/ready` returns 200 only when Postgres is up **and** at least one provider loaded tools. For a working deploy, set `RENDER_API_KEY` (or another provider credential). Use `TOOLSHED_ALLOW_EMPTY=true` only for dev/testing.

**Plan note:** Use **Starter** or higher for the web service. Free tier spins down after inactivity.

#### Post-deploy checklist

1. Confirm health: `curl https://<your-service>.onrender.com/ready`
2. **Unset `TOOLSHED_BOOTSTRAP_API_KEY`** in the Dashboard — auth uses the `api_keys` table only after first migrate
3. Connect your MCP client (see below)
4. Add more API keys via Postgres if needed (see [RBAC](#rbac))

### 4. Connect an MCP client

Your toolshed URL:

```
https://<your-service>.onrender.com/mcp
```

All requests require:

```
Authorization: Bearer <your-api-key>
```

#### Cursor

Add to MCP settings (`.cursor/mcp.json` or Cursor Settings → MCP):

```json
{
  "mcpServers": {
    "toolshed": {
      "url": "https://<your-service>.onrender.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

#### Claude Desktop / other Streamable HTTP clients

Use the same URL and `Authorization` header. Clients must support MCP Streamable HTTP.

### 5. Use the agent workflow

After connecting, agents discover tools progressively:

```
1. tools/list        → [search_tools, get_tool_schema]
2. search_tools      → { "query": "list render services" }
3. get_tool_schema   → { "name": "render.list_services" }
4. tools/call        → { "name": "render.list_services", "arguments": { ... } }
```

Example `search_tools` query strings:

- `"list render services"`
- `"create pull request on github"`
- `"post slack message"`

### 6. Add or enable providers

Providers are TypeScript modules in `providers/`. Each is enabled when its env vars are set.

| Provider | File | Enable with |
|----------|------|-------------|
| Render | `providers/render.ts` | `RENDER_API_KEY` |
| GitHub | `providers/github.ts` | `GITHUB_TOKEN` (official hosted MCP) |
| Slack | `providers/slack.ts` | `SLACK_BOT_TOKEN` + `SLACK_TEAM_ID` (direct Web API adapter) |
| Custom | `providers/custom.ts` | `TICKET_API_URL` + `TICKET_API_KEY` |

To add a new provider:

1. Create `providers/my-api.ts` (copy a stub)
2. Add every approved remote/stdio tool to its explicit `toolPolicy`; unlisted upstream tools are ignored
3. Register it in `providers/index.ts`
4. Commit, push, and redeploy

### Slack setup

1. Create an app at [api.slack.com/apps](https://api.slack.com/apps) → **From scratch**
2. **OAuth & Permissions** → add bot scopes: `channels:history`, `channels:read`, `chat:write`, `reactions:write`, `users:read`, `users.profile:read`
3. **Install to Workspace** → copy the **Bot User OAuth Token** (`xoxb-...`)
4. Get your **Workspace ID** (`T...`) from [Slack workspace settings](https://slack.com/help/articles/221769328-Locate-your-Slack-URL-or-ID#find-your-workspace-or-org-id)
5. Set on the Render service (or local `.env`):

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_TEAM_ID=T...
```

6. Redeploy, then `/invite @your-bot` in any channel the agent should use

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| `/ready` returns 503 | Set a provider credential (`RENDER_API_KEY`) or `TOOLSHED_ALLOW_EMPTY=true` |
| `401` on `/mcp` | Check `Authorization: Bearer …` matches a key in `api_keys` |
| Deploy stuck on health check | Postgres not ready, or zero providers loaded — check logs |
| No Render tools in search | Verify `RENDER_API_KEY` is set and service restarted after adding it |
| No Slack tools in search | Set both `SLACK_BOT_TOKEN` and `SLACK_TEAM_ID`, then redeploy |
| Bootstrap key stopped working | Check whether the key was revoked or expired in `api_keys`; migrations never overwrite an existing key set |

View logs in the Render Dashboard → **mcp-toolshed** → **Logs**.

---

## Adding a provider

See [Setup guide §6](#6-add-or-enable-providers) for the workflow. Provider types:

| Type | Use for |
|------|---------|
| `mcp-remote` | Hosted MCP servers (Render MCP, GitHub MCP) |
| `mcp-stdio` | Locally installed MCP binaries that require stdio |
| `inline` | Custom REST APIs with TypeScript handlers |

GitHub uses GitHub's maintained hosted MCP endpoint with PAT authentication.
Slack uses a small in-process Web API adapter so bot-token deployments do not
depend on the archived reference MCP package.

## RBAC

Policy lives in `config/rbac.ts`. Roles: `analyst`, `implementer`, `admin`.

Remote and stdio tools are deny-by-default. Their exact upstream names, risk,
tags, and required scoping arguments are declared in `config/tool-policy.ts`.
New or renamed upstream tools remain unavailable until reviewed.

RBAC is enforced at three layers:

1. `search_tools` — only returns discoverable tools (non-empty query required)
2. `get_tool_schema` — denied if not allowed to view
3. `tools/call` — denied if not allowed to execute

Insert additional API keys (hash must match Node `sha256` of the UTF-8 key string):

```bash
node -e "const c=require('crypto'); console.log(c.createHash('sha256').update('my-secret-key').digest('hex'))"
```

```sql
INSERT INTO api_keys (key_hash, role, label)
VALUES ('<hash-from-above>', 'implementer', 'ci-bot');
```

Keys can be time-bounded with `expires_at` or revoked without deleting audit
history:

```sql
UPDATE api_keys SET revoked_at = now() WHERE label = 'ci-bot';
```

## Health

- `GET /ready` — public, minimal response; 200 when Postgres is up and at least one approved provider tool is loaded (or `TOOLSHED_ALLOW_EMPTY=true`)
- `GET /health` — admin-authenticated diagnostics with per-provider and audit-pipeline state

Optional provider failures report degraded health without removing healthy
providers from service. Provider calls use bounded queues whose deadlines begin
at admission, and cancellation propagates to upstream clients.

## Audit retention

Arguments are recursively redacted before storage, including nested secret
objects and environment-variable key/value pairs. Oversized payloads are
truncated. Write operations require a durable `started` audit record before
execution. The daily Cron Job marks abandoned intents `unknown` and deletes
expired rows in bounded batches.

## Project layout

```
providers/          # Tool sources — edit these
config/             # Role policies and explicit remote-tool allowlists
toolshed/           # Core server (don't fork unless extending)
migrations/         # Postgres schema (audit + api_keys)
```
