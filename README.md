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

## Quick start (local)

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm run db:migrate
npm run dev
```

Connect an MCP client to `http://localhost:3000/mcp` with:

```
Authorization: Bearer dev-toolshed-key-change-me
```

If no provider credentials are set, add `TOOLSHED_ALLOW_EMPTY=true` for local `/ready` checks.

## Deploy to Render

```bash
render blueprint launch
```

1. Set `TOOLSHED_BOOTSTRAP_API_KEY` before first deploy (inserted into `api_keys` on migrate).
2. Set provider credentials (`RENDER_API_KEY`, etc.).
3. **Unset `TOOLSHED_BOOTSTRAP_API_KEY`** after deploy — auth uses the `api_keys` table only.

## Adding a provider

1. Create `providers/my-api.ts` (see stubs: `render.ts`, `github.ts`, `slack.ts`, `custom.ts`)
2. Register it in `providers/index.ts`
3. Commit and deploy

### Provider types

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

## Agent workflow

```
1. tools/list        → [search_tools, get_tool_schema]
2. search_tools      → matching tool names (RBAC-filtered)
3. get_tool_schema   → full inputSchema for one tool
4. tools/call        → execute via provider adapter
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
