# @justdoit/mcp

MCP server exposing justdoit tasks over `@justdoit/core` (in-process). This
package ships a **local-stdio entrypoint only** — `createMcpServer(ctx)` is
also reused by the key-gated, per-user `/mcp` streamable-HTTP route served by
`apps/api` (see its README), which is how hosted/remote agents connect.

## Run

- **stdio** (default, local use): `JUSTDOIT_DB=./justdoit.db pnpm --filter @justdoit/mcp start`

## Environment

| Var           | Default       | Purpose           |
| ------------- | ------------- | ------------------ |
| `JUSTDOIT_DB` | `justdoit.db` | SQLite file path   |

## Register in an agent harness (stdio)

Add to your harness `mcpServers` config (e.g. `~/.claude.json` / `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "justdoit": {
      "command": "tsx",
      "args": ["/absolute/path/to/justdoit/apps/mcp/src/stdio.ts"],
      "env": {
        "JUSTDOIT_DB": "/absolute/path/to/justdoit/justdoit.db"
      }
    }
  }
}
```

If `tsx` is not on PATH, use `pnpm`:

```json
{
  "mcpServers": {
    "justdoit": {
      "command": "pnpm",
      "args": ["--filter", "@justdoit/mcp", "start"],
      "env": { "JUSTDOIT_DB": "/absolute/path/to/justdoit/justdoit.db" }
    }
  }
}
```

## Register over HTTP (hosted)

There is no standalone hosted `mcp` service. Remote/hosted agents point an
HTTP-capable MCP client at `https://<api-domain>/mcp` and send a per-user
`X-API-Key` (minted from the web app's Settings screen) — see `apps/api`.

## Tools, resources, prompts

17 tools (`create_task`, `update_task`, `list_tasks`, `get_task`, `set_status`,
`complete_task`, `delete_task`, `start_timer`, `stop_timer`, `log_time`,
`create_project`, `list_projects`, `add_tag`, `search_tasks`, `get_time_report`,
`set_reminder`, `quick_add`); 4 resources (`task://{id}`, `project://{id}`,
`tasks://today`, `tasks://overdue`); 2 prompts (`plan_my_day`,
`summarize_progress`). See `src/tools/`, `src/resources.ts`, `src/prompts.ts`.
