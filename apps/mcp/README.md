# @justdoit/mcp

MCP server exposing justdoit tasks over `@justdoit/core` (in-process).

## Run

- **stdio** (default): `JUSTDOIT_DB=./justdoit.db pnpm --filter @justdoit/mcp start`
- **HTTP**: `JUSTDOIT_DB=./justdoit.db JUSTDOIT_MCP_PORT=3939 JUSTDOIT_API_KEY=secret pnpm --filter @justdoit/mcp start:http`

## Environment

| Var                 | Default       | Purpose                                                                             |
| ------------------- | ------------- | ----------------------------------------------------------------------------------- |
| `JUSTDOIT_DB`       | `justdoit.db` | SQLite file path                                                                    |
| `JUSTDOIT_API_KEY`  | _(unset)_     | If set, HTTP transport requires `Authorization: Bearer <key>` or `X-API-Key: <key>` |
| `JUSTDOIT_MCP_PORT` | `3939`        | HTTP transport port                                                                 |

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

## Register over HTTP

Point an HTTP-capable MCP client at `http://localhost:3939` and send `Authorization: Bearer <JUSTDOIT_API_KEY>` if auth is enabled.

## Tools, resources, prompts

17 tools (`create_task`, `update_task`, `list_tasks`, `get_task`, `set_status`,
`complete_task`, `delete_task`, `start_timer`, `stop_timer`, `log_time`,
`create_project`, `list_projects`, `add_tag`, `search_tasks`, `get_time_report`,
`set_reminder`, `quick_add`); 4 resources (`task://{id}`, `project://{id}`,
`tasks://today`, `tasks://overdue`); 2 prompts (`plan_my_day`,
`summarize_progress`). See `src/tools/`, `src/resources.ts`, `src/prompts.ts`.
