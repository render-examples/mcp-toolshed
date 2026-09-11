# MCP Toolshed

A standalone MCP aggregation layer for Render users. One endpoint, many tools — discovered via `search_tools`, governed by RBAC, backed by a code registry.

Agents connect to a single URL instead of configuring Render, GitHub, Slack, and custom MCP servers separately.

## Architecture

- **One Web Service** — gateway, search, and all provider adapters run in-process
- **One Postgres** — audit log and API key → role mapping (not the tool catalog)
- **Code registry** — tool definitions in `providers/*.ts`, loaded at startup

```
Agent → POST /mcp → search_tools → get_tool_schema → tools/call → provider adapter
```

`tools/list` intentionally returns only meta-tools. Server instructions tell agents to use progressive discovery.

---

## Setup guide

### Prerequisites

- **Node.js 22+**
- **Docker** (local Postgres only)
- **Render account** ([dashboard.render.com](https://dashboard.render.com))
- **Render CLI** (optional, for Blueprint deploy): `brew install render && render login`

### 1. Clone and configure

```bash
git clone https://github.com/render-lab/mcp-toolshed.git
cd mcp-toolshed
cp .env.example .env
```

Edit `.env` — at minimum set:

| Variable | Local value | Notes |
|----------|-------------|-------|
| `DATABASE_URL` | `postgresql://toolshed:toolshed@localhost:5433/toolshed` | Matches `docker-compose.yml` |
| `TOOLSHED_BOOTSTRAP_API_KEY` | any secret string | Becomes your admin API key after migrate |
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

The repo includes a Blueprint (`render.yaml`) that creates **one Web Service** + **one Postgres database**.

#### Option A — Render CLI

```bash
render blueprint launch
```

Select your workspace and confirm resource creation when prompted.

#### Option B — Render Dashboard

1. Go to [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**
2. Connect the `render-lab/mcp-toolshed` repository
3. Review the two resources (`mcp-toolshed`, `toolshed-db`) and apply

#### Secrets to set at deploy time

Render prompts for these (`sync: false` in `render.yaml`):

| Variable | Required | Purpose |
|----------|----------|---------|
| `TOOLSHED_BOOTSTRAP_API_KEY` | **Yes (first deploy)** | Admin API key; hashed into `api_keys` on migrate |
| `RENDER_API_KEY` | Recommended | Enables Render MCP tools (`render.*`) |
| `GITHUB_TOKEN` | Optional | Enables GitHub tools (`github.*`) |
| `SLACK_BOT_TOKEN` | Optional | Slack bot token (`xoxb-...`) — see [Slack setup](#slack-setup) |
| `SLACK_TEAM_ID` | With Slack | Workspace ID (`T...`) — required with `SLACK_BOT_TOKEN` |
| `SLACK_CHANNEL_IDS` | Optional | Comma-separated channel IDs to limit access |
| `RENDER_MCP_URL` | Optional | Defaults to `https://mcp.render.com/mcp` |
| `TICKET_API_URL` / `TICKET_API_KEY` | Optional | Enables custom inline provider stub |

**Health check note:** `/ready` returns 200 only when Postgres is up **and** at least one provider loaded tools. For a working deploy, set `RENDER_API_KEY` (or another provider credential). Use `TOOLSHED_ALLOW_EMPTY=true` only for dev/testing.

**Plan note:** Use **Starter** or higher for the web service. Free tier spins down after inactivity.

#### Post-deploy checklist

1. Confirm health: `curl https://mcp-toolshed.onrender.com/ready`
2. **Unset `TOOLSHED_BOOTSTRAP_API_KEY`** in the Dashboard — auth uses the `api_keys` table only after first migrate
3. Connect your MCP client (see below)
4. Add more API keys via Postgres if needed (see [RBAC](#rbac))

### 4. Connect an MCP client

Production toolshed URL:

```
https://mcp-toolshed.onrender.com/mcp
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
      "url": "https://mcp-toolshed.onrender.com/mcp",
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
| GitHub | `providers/github.ts` | `GITHUB_TOKEN` |
| Slack | `providers/slack.ts` | `SLACK_BOT_TOKEN` + `SLACK_TEAM_ID` |
| Custom | `providers/custom.ts` | `TICKET_API_URL` + `TICKET_API_KEY` |

To add a new provider:

1. Create `providers/my-api.ts` (copy a stub)
2. Register it in `providers/index.ts`
3. Commit, push, and redeploy

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
| Bootstrap key stopped working | Expected after unsetting env var — key should still work via `api_keys` table; re-run migrate if needed |

View logs in the Render Dashboard → **mcp-toolshed** → **Logs**.

---

## Adding a provider

See [Setup guide §6](#6-add-or-enable-providers) for the workflow. Provider types:

| Type | Use for |
|------|---------|
| `mcp-remote` | Hosted MCP servers (Render MCP) |
| `mcp-stdio` | Bundled community MCP servers (GitHub, Slack) |
| `inline` | Custom REST APIs with TypeScript handlers |

GitHub and Slack use packages from `package.json` (not `npx` at runtime).

## RBAC

Policy lives in `config/rbac.ts`. Roles: `analyst`, `implementer`, `deploy-manager`, `admin`.

Upstream tools inherit **per-tool risk** (`list_*` / `get_*` → read; others → provider default).

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

## Health

- `GET /ready` — 200 when Postgres is up and at least one provider tool is loaded (or `TOOLSHED_ALLOW_EMPTY=true`)
- `GET /health` — same checks with full status payload

## Project layout

```
providers/          # Tool sources — edit these
config/rbac.ts      # Role policies
toolshed/           # Core server (don't fork unless extending)
migrations/         # Postgres schema (audit + api_keys)
```

See [seed.md](./seed.md) for design research and rationale.
