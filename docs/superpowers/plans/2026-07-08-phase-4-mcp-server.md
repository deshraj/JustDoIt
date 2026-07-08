# Phase 4: MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `apps/mcp` (`@justdoit/mcp`) — a thin MCP adapter that imports `@justdoit/core` in-process and exposes tasks, projects, tags, time tracking, reminders, and quick-add as MCP **tools**, **resources**, and **prompts** over both **stdio** and **streamable-HTTP** transports. Proven by in-process tests that drive a `Client` over `InMemoryTransport` and assert both tool output and DB side effects.

**Architecture:** The MCP server is a pure adapter. A single factory `createMcpServer(db: Db): McpServer` wires every tool/resource/prompt to a `core` service call — no business rules, no validation logic beyond a zod raw shape at the tool boundary (which reuses/derives from `core` Zod schemas). Because the factory takes an already-open `Db`, it is fully testable in-process against an in-memory SQLite database. Two thin entrypoints (`src/stdio.ts`, `src/http.ts`) open the DB from `JUSTDOIT_DB`, call `createMcpServer`, and connect a transport. HTTP is guarded by an optional bearer/`X-API-Key` check when `JUSTDOIT_API_KEY` is set.

**Tech Stack:** `@modelcontextprotocol/sdk` (current TypeScript SDK, `McpServer` high-level API), `zod` 3, `@justdoit/core` (`workspace:*`), `tsx` (dev/run), Vitest 3. Node `>=22`, ESM, TS strict, `moduleResolution: "Bundler"`, `verbatimModuleSyntax`.

## Global Constraints

- Package name `@justdoit/mcp`; location `apps/mcp`; `"type": "module"`. Verbatim.
- MCP imports `@justdoit/core` **directly, in-process** — never over HTTP. Verbatim.
- Every tool is thin: validate input with a zod raw shape (reuse/derive from `core` schemas), call exactly one `core` service method with `(db, ...)`, return `{ content: [{ type: 'text', text }] }`. No business logic in the adapter.
- Tool results serialize the service return value as pretty JSON in a single `text` content block, unless noted. On a thrown/validation error, return `{ content: [...], isError: true }` (see Task 2 helper).
- Clock: any service that needs "now" is passed `now: new Date()` from the adapter so behavior stays deterministic under test where the test controls it via a fake service call; the adapter itself uses the real clock.
- DB path resolves from env `JUSTDOIT_DB` (default `justdoit.db`) in the entrypoints only. The factory never reads env.
- SDK import paths used (state assumptions if the installed version differs):
  - `McpServer`, `ResourceTemplate` → `@modelcontextprotocol/sdk/server/mcp.js`
  - `StdioServerTransport` → `@modelcontextprotocol/sdk/server/stdio.js`
  - `StreamableHTTPServerTransport` → `@modelcontextprotocol/sdk/server/streamableHttp.js`
  - `Client` → `@modelcontextprotocol/sdk/client/index.js`
  - `InMemoryTransport` → `@modelcontextprotocol/sdk/inMemory.js`

---

## Assumptions (state explicitly, verify against installed SDK/core)

1. **SDK shape.** `server.registerTool(name, { title, description, inputSchema }, handler)` where `inputSchema` is a **zod raw shape object** (`{ field: z.string(), ... }`, not a wrapped `z.object`). `handler(args)` returns `{ content: [...] }`. `server.registerResource(name, uriOrTemplate, metadata, handler)`; parameterized URIs use `new ResourceTemplate('task://{id}', { list: undefined })`. `server.registerPrompt(name, { title, description, argsSchema }, handler)` returns `{ messages: [...] }`. If the installed SDK version differs (e.g. older `server.tool(...)` signature), keep the tool/resource/prompt semantics identical and adapt the registration call — NOTE the deviation in the commit.
2. **Core services (Phases 1–3) are available** with `(db, ...args)` signatures: `taskService.{create,get,list,update,setStatus,complete,remove,addSubtask}`, `projectService.{create,get,list,update,remove}`, `tagService.{create,list,attach,detach}`, `timeService.{startTimer,stopTimer,logManual,listEntries,getRunning}`, `reportService.timeReport`, `reminderService.{create,dueReminders}`, and `quickAddService.create(db, text, now?)`. Exact method names/inputs are taken from `@justdoit/core`'s exports; if a name differs, use the actual export and NOTE it. Clock is a trailing optional positional `now?: Date` (Phases 1–3 convention), NOT an options object.
3. **Core Zod input schemas** live in `packages/core/src/schemas/` and are re-exported from `@justdoit/core` (e.g. `createTaskSchema`, `updateTaskSchema`, `listTasksSchema`, `createProjectSchema`, `timeReportSchema`, etc.). The adapter derives tool raw shapes from these via `.shape` where a matching schema exists, and otherwise defines a minimal local raw shape. If a schema is missing, define the raw shape inline in the adapter and NOTE it for a later core backfill.
4. Core exposes `createDb`, `runMigrations`, and type `Db` (Phase 0). Verified from Phase 0 plan.
5. `tasks://today` = tasks with `dueAt` within the local calendar day; `tasks://overdue` = tasks with `dueAt < now` and status not in (`done`,`cancelled`). These are computed by calling `taskService.list` with the appropriate filters (no new core method required). If `taskService.list` filters can't express a date range, add a thin core query in a follow-up and NOTE it.

---

## File Structure

```
apps/mcp/
├── package.json                 # @justdoit/mcp: sdk, zod, @justdoit/core (workspace:*), tsx, vitest
├── tsconfig.json                # extends ../../tsconfig.base.json
├── vitest.config.ts
├── README.md                    # mcpServers registration snippet (Task 9)
└── src/
    ├── server.ts                # createMcpServer(db): McpServer — registers everything
    ├── helpers.ts               # ok()/fail() content helpers, jsonText()
    ├── tools/
    │   ├── index.ts             # registerTools(server, db)
    │   ├── tasks.ts             # create/update/list/get/set_status/complete/delete/search
    │   ├── projects.ts          # create_project/list_projects/add_tag
    │   ├── time.ts              # start_timer/stop_timer/log_time/get_time_report
    │   └── misc.ts              # set_reminder/quick_add
    ├── resources.ts             # registerResources(server, db)
    ├── prompts.ts               # registerPrompts(server)
    ├── stdio.ts                 # bin entry: stdio transport
    ├── http.ts                  # streamable-HTTP entry + optional auth
    └── __tests__/
        ├── helpers.ts           # makeClient(db) → { client, server } over InMemoryTransport
        ├── task-tools.test.ts
        ├── project-tag-tools.test.ts
        ├── time-tools.test.ts
        ├── misc-tools.test.ts
        ├── resources.test.ts
        └── prompts.test.ts
```

---

## Full tool list (input params)

All params are the tool's zod raw shape. "→ core" names the service call. Output is a single JSON `text` block unless noted.

| Tool              | Input params                                                                                                                                                                          | → core                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `create_task`     | `title` (string, req), `description?`, `status?` (enum), `priority?` (enum), `projectId?`, `parentTaskId?`, `dueAt?` (ISO string→Date), `startAt?`, `estimateMinutes?`, `recurrence?` | `taskService.create(db, input)`                                                                              |
| `update_task`     | `id` (req) + all `create_task` fields optional                                                                                                                                        | `taskService.update(db, id, patch)`                                                                          |
| `list_tasks`      | `status?`, `projectId?`, `priority?`, `tag?`, `parentTaskId?`, `dueBefore?`, `dueAfter?`, `archived?`, `limit?`, `sort?`                                                              | `taskService.list(db, filters)`                                                                              |
| `get_task`        | `id` (req)                                                                                                                                                                            | `taskService.get(db, id)`                                                                                    |
| `set_status`      | `id` (req), `status` (enum, req)                                                                                                                                                      | `taskService.setStatus(db, id, status)`                                                                      |
| `complete_task`   | `id` (req)                                                                                                                                                                            | `taskService.complete(db, id, now)`                                                                          |
| `delete_task`     | `id` (req)                                                                                                                                                                            | `taskService.remove(db, id)`                                                                                 |
| `start_timer`     | `taskId` (req)                                                                                                                                                                        | `timeService.startTimer(db, taskId, now)`                                                                    |
| `stop_timer`      | `taskId?` (defaults to running)                                                                                                                                                       | `timeService.stopTimer(db, { taskId }, now)`                                                                 |
| `log_time`        | `taskId` (req), `minutes` (int, req), `startedAt?`, `note?`                                                                                                                           | `timeService.logManual(db, { taskId, startedAt, durationSeconds: minutes*60, note }, now)` (minutes→seconds) |
| `create_project`  | `name` (req), `color?`, `icon?`, `description?`                                                                                                                                       | `projectService.create(db, input)`                                                                           |
| `list_projects`   | `includeArchived?`                                                                                                                                                                    | `projectService.list(db, opts)`                                                                              |
| `add_tag`         | `taskId` (req), `name` (req), `color?`                                                                                                                                                | `tagService.create` (upsert) + `tagService.attach(db, taskId, tagId)`                                        |
| `search_tasks`    | `q` (string, req), `limit?`                                                                                                                                                           | `taskService.list(db, { q })` (full-text)                                                                    |
| `get_time_report` | `groupBy` (`day\|project\|tag`), `from?`, `to?`                                                                                                                                       | `reportService.timeReport(db, opts)`                                                                         |
| `set_reminder`    | `taskId` (req), `remindAt` (ISO, req)                                                                                                                                                 | `reminderService.create(db, input)`                                                                          |
| `quick_add`       | `text` (string, req)                                                                                                                                                                  | `quickAddService.create(db, text, now)`                                                                      |

**17 tools.** Resources: `task://{id}`, `project://{id}`, `tasks://today`, `tasks://overdue`. Prompts: `plan_my_day`, `summarize_progress`.

---

## Task 1: Scaffold `apps/mcp` + server factory + smoke test

**Files:**

- Create: `apps/mcp/package.json`
- Create: `apps/mcp/tsconfig.json`
- Create: `apps/mcp/vitest.config.ts`
- Create: `apps/mcp/src/helpers.ts`
- Create: `apps/mcp/src/server.ts`
- Create: `apps/mcp/src/tools/index.ts` (empty registrar for now)
- Create: `apps/mcp/src/__tests__/helpers.ts`
- Create: `apps/mcp/src/__tests__/task-tools.test.ts` (smoke test only in this task)

**Interfaces:**

- Consumes: `@justdoit/core` (`createDb`, `runMigrations`, type `Db`); the workspace/tooling from Phase 0.
- Produces:
  - `createMcpServer(db: Db): McpServer` — constructs an `McpServer` named `justdoit`, calls `registerTools/registerResources/registerPrompts` (stubs wired incrementally), returns the server.
  - `apps/mcp/src/helpers.ts`: `jsonText(value): string`, `ok(value)`, `fail(error)` content builders.
  - Test helper `makeClient(db)` returning a connected `{ client, server }` over `InMemoryTransport.createLinkedPair()`.
  - `@justdoit/mcp` in the workspace with `dev`/`start`/`test`/`typecheck` scripts.

- [ ] **Step 1: Write `apps/mcp/package.json`**

```json
{
  "name": "@justdoit/mcp",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": {
    "justdoit-mcp": "./src/stdio.ts"
  },
  "scripts": {
    "dev": "tsx watch src/stdio.ts",
    "start": "tsx src/stdio.ts",
    "start:http": "tsx src/http.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@justdoit/core": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3",
    "vitest": "^3.0.0"
  }
}
```

> NOTE: `@modelcontextprotocol/sdk` version `^1.12.0` is an assumption — pin to whatever `pnpm add` resolves; the `McpServer`/`registerTool` API is stable across recent 1.x. The `bin` points at a `.ts` file run via the shebang + `tsx` (see Task 9); dev-time consumption of `core`/mcp is TypeScript source, consistent with Phase 0's "no build step yet" note.

- [ ] **Step 2: Write `apps/mcp/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 3: Write `apps/mcp/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Write `apps/mcp/src/helpers.ts`**

```ts
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Success content block(s) from a service return value. */
export function ok(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: jsonText(value) }] };
}

/** Error content block; MCP surfaces isError to the caller. */
export function fail(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Wrap a tool body so thrown errors (incl. core validation) become isError results. */
export async function guard(fn: () => Promise<unknown> | unknown): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (error) {
    return fail(error);
  }
}
```

> NOTE: `CallToolResult` import path `@modelcontextprotocol/sdk/types.js` is an assumption; if the type is not exported there, type the helpers as `{ content: { type: 'text'; text: string }[]; isError?: boolean }` and NOTE it.

- [ ] **Step 5: Write `apps/mcp/src/tools/index.ts` (stub)**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Db } from '@justdoit/core';

// Tool registrars are added incrementally in Tasks 2–6.
export function registerTools(_server: McpServer, _db: Db): void {
  // no-op until Task 2
}
```

- [ ] **Step 6: Write `apps/mcp/src/server.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Db } from '@justdoit/core';
import { registerTools } from './tools/index.js';

export function createMcpServer(db: Db): McpServer {
  const server = new McpServer({
    name: 'justdoit',
    version: '0.0.0',
  });

  registerTools(server, db);
  // registerResources(server, db); // Task 7
  // registerPrompts(server);       // Task 8

  return server;
}
```

- [ ] **Step 7: Write the test helper `apps/mcp/src/__tests__/helpers.ts`**

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDb, runMigrations, type Db } from '@justdoit/core';
import { createMcpServer } from '../server.js';

export function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

/** Link a Client to a fresh justdoit server over an in-memory transport pair. */
export async function makeClient(db: Db) {
  const server = createMcpServer(db);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

/** Parse the first text content block of a tool result as JSON. */
export function firstJson(result: { content: { type: string; text?: string }[] }): unknown {
  const block = result.content.find((c) => c.type === 'text');
  return block?.text ? JSON.parse(block.text) : undefined;
}
```

- [ ] **Step 8: Write the smoke test — `apps/mcp/src/__tests__/task-tools.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { freshDb, makeClient } from './helpers.js';

describe('mcp server bootstrap', () => {
  it('connects and lists tools (empty until Task 2)', async () => {
    const { client } = await makeClient(freshDb());
    const { tools } = await client.listTools();
    expect(Array.isArray(tools)).toBe(true);
  });
});
```

- [ ] **Step 9: Install deps**

Run: `pnpm install`
Expected: adds `@justdoit/mcp` to the workspace; installs `@modelcontextprotocol/sdk`, `tsx`, `zod`. No build-script warnings (no native deps here).

- [ ] **Step 10: Run the smoke test**

Run: `pnpm --filter @justdoit/mcp test`
Expected: PASS — 1 test green (server connects, `listTools` returns an array).

- [ ] **Step 11: Typecheck**

Run: `pnpm --filter @justdoit/mcp typecheck`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(mcp): scaffold @justdoit/mcp with createMcpServer factory"
```

---

## Task 2: Task write tools (create / update / set_status / complete / delete)

**Files:**

- Create: `apps/mcp/src/tools/tasks.ts`
- Modify: `apps/mcp/src/tools/index.ts` (call `registerTaskTools`)
- Modify: `apps/mcp/src/__tests__/task-tools.test.ts`

**Interfaces:**

- Consumes: `taskService.{create,update,setStatus,complete,remove}` from `@justdoit/core`; core Zod schemas `createTaskSchema`/`updateTaskSchema` (derive raw shape via `.shape`); `guard`/`ok` helpers; `TASK_STATUSES`, `TASK_PRIORITIES` enums from core.
- Produces: registered tools `create_task`, `update_task`, `set_status`, `complete_task`, `delete_task`, each returning JSON of the affected task. `registerTaskTools(server, db)` exported and called from `registerTools`.

- [ ] **Step 1: Write failing tests — append to `apps/mcp/src/__tests__/task-tools.test.ts`**

```ts
import { eq } from 'drizzle-orm';
import { tasks } from '@justdoit/core';
import { firstJson } from './helpers.js';

describe('task write tools', () => {
  it('create_task inserts a task and returns it', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const res = await client.callTool({
      name: 'create_task',
      arguments: { title: 'Write MCP plan', priority: 'p1' },
    });
    const task = firstJson(res) as { id: string; title: string; priority: string };
    expect(task.title).toBe('Write MCP plan');
    expect(task.priority).toBe('p1');

    const rows = db.select().from(tasks).where(eq(tasks.id, task.id)).all();
    expect(rows).toHaveLength(1);
  });

  it('update_task patches fields', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const created = firstJson(
      await client.callTool({ name: 'create_task', arguments: { title: 'Old' } }),
    ) as { id: string };
    const updated = firstJson(
      await client.callTool({
        name: 'update_task',
        arguments: { id: created.id, title: 'New' },
      }),
    ) as { title: string };
    expect(updated.title).toBe('New');
  });

  it('set_status changes status', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const created = firstJson(
      await client.callTool({ name: 'create_task', arguments: { title: 'T' } }),
    ) as { id: string };
    const res = firstJson(
      await client.callTool({
        name: 'set_status',
        arguments: { id: created.id, status: 'in_progress' },
      }),
    ) as { status: string };
    expect(res.status).toBe('in_progress');
  });

  it('complete_task sets status done and completedAt', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const created = firstJson(
      await client.callTool({ name: 'create_task', arguments: { title: 'T' } }),
    ) as { id: string };
    const res = firstJson(
      await client.callTool({ name: 'complete_task', arguments: { id: created.id } }),
    ) as { status: string; completedAt: unknown };
    expect(res.status).toBe('done');
    expect(res.completedAt).toBeTruthy();
  });

  it('delete_task removes the row', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const created = firstJson(
      await client.callTool({ name: 'create_task', arguments: { title: 'T' } }),
    ) as { id: string };
    await client.callTool({ name: 'delete_task', arguments: { id: created.id } });
    const rows = db.select().from(tasks).where(eq(tasks.id, created.id)).all();
    expect(rows).toHaveLength(0);
  });

  it('create_task with invalid status returns isError', async () => {
    const { client } = await makeClient(freshDb());
    const res = await client.callTool({
      name: 'create_task',
      arguments: { title: 'T', status: 'nope' },
    });
    expect(res.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @justdoit/mcp test`
Expected: FAIL — `create_task` (and the rest) are unknown tools / rejected by the server.

- [ ] **Step 3: Write `apps/mcp/src/tools/tasks.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { taskService, TASK_STATUSES, TASK_PRIORITIES, type Db } from '@justdoit/core';
import { guard } from '../helpers.js';

// Coerce ISO date strings from agents into Date for date fields.
const isoDate = z.coerce.date();

const createShape = {
  title: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  projectId: z.string().optional(),
  parentTaskId: z.string().optional(),
  dueAt: isoDate.optional(),
  startAt: isoDate.optional(),
  estimateMinutes: z.number().int().positive().optional(),
  recurrence: z.string().optional(),
};

const updateShape = {
  id: z.string(),
  ...Object.fromEntries(
    Object.entries(createShape).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()]),
  ),
} as typeof createShape & { id: z.ZodString };

export function registerTaskTools(server: McpServer, db: Db): void {
  server.registerTool(
    'create_task',
    {
      title: 'Create task',
      description: 'Create a new task. Dates accept ISO 8601 strings.',
      inputSchema: createShape,
    },
    (args) => guard(() => taskService.create(db, args)),
  );

  server.registerTool(
    'update_task',
    {
      title: 'Update task',
      description: 'Patch an existing task by id.',
      inputSchema: updateShape,
    },
    ({ id, ...patch }) => guard(() => taskService.update(db, id, patch)),
  );

  server.registerTool(
    'set_status',
    {
      title: 'Set task status',
      description: 'Move a task to a new status.',
      inputSchema: { id: z.string(), status: z.enum(TASK_STATUSES) },
    },
    ({ id, status }) => guard(() => taskService.setStatus(db, id, status)),
  );

  server.registerTool(
    'complete_task',
    {
      title: 'Complete task',
      description: 'Mark a task done (spawns next occurrence if recurring).',
      inputSchema: { id: z.string() },
    },
    ({ id }) => guard(() => taskService.complete(db, id, new Date())),
  );

  server.registerTool(
    'delete_task',
    {
      title: 'Delete task',
      description: 'Permanently delete a task and its subtasks.',
      inputSchema: { id: z.string() },
    },
    ({ id }) => guard(() => taskService.remove(db, id)),
  );
}
```

> NOTE: `updateShape` is derived programmatically for brevity; if `verbatimModuleSyntax`/TS strictness complains about the `Object.fromEntries` cast, replace it with an explicit object literal mirroring `createShape` with every field `.optional()` plus `id: z.string()`. Prefer reusing `updateTaskSchema.shape` from core if it exists — NOTE which path you took.

- [ ] **Step 4: Wire into `apps/mcp/src/tools/index.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Db } from '@justdoit/core';
import { registerTaskTools } from './tasks.js';

export function registerTools(server: McpServer, db: Db): void {
  registerTaskTools(server, db);
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @justdoit/mcp test`
Expected: PASS — all task write-tool tests + the smoke test green.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @justdoit/mcp typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(mcp): add task write tools (create/update/set_status/complete/delete)"
```

---

## Task 3: Task read tools (get / list / search)

**Files:**

- Modify: `apps/mcp/src/tools/tasks.ts` (add read tools)
- Modify: `apps/mcp/src/__tests__/task-tools.test.ts`

**Interfaces:**

- Consumes: `taskService.{get,list}` from core (list accepts filter object incl. `status`, `projectId`, `priority`, `tag`, `parentTaskId`, `dueBefore`, `dueAfter`, `archived`, `limit`, `sort`, and free-text `q`).
- Produces: tools `get_task`, `list_tasks`, `search_tasks`. `list_tasks`/`search_tasks` return a JSON array; `get_task` returns the task or `null`.

- [ ] **Step 1: Write failing tests — append to `task-tools.test.ts`**

```ts
describe('task read tools', () => {
  it('get_task returns a task by id', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const created = firstJson(
      await client.callTool({ name: 'create_task', arguments: { title: 'Find me' } }),
    ) as { id: string };
    const got = firstJson(
      await client.callTool({ name: 'get_task', arguments: { id: created.id } }),
    ) as { title: string };
    expect(got.title).toBe('Find me');
  });

  it('list_tasks filters by status', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    await client.callTool({ name: 'create_task', arguments: { title: 'A', status: 'todo' } });
    await client.callTool({ name: 'create_task', arguments: { title: 'B', status: 'done' } });
    const list = firstJson(
      await client.callTool({ name: 'list_tasks', arguments: { status: 'done' } }),
    ) as { title: string }[];
    expect(list.map((t) => t.title)).toEqual(['B']);
  });

  it('search_tasks matches title text', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    await client.callTool({ name: 'create_task', arguments: { title: 'buy milk' } });
    await client.callTool({ name: 'create_task', arguments: { title: 'call bob' } });
    const list = firstJson(
      await client.callTool({ name: 'search_tasks', arguments: { q: 'milk' } }),
    ) as { title: string }[];
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('buy milk');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @justdoit/mcp test`
Expected: FAIL — `get_task`/`list_tasks`/`search_tasks` unknown.

- [ ] **Step 3: Add read tools to `apps/mcp/src/tools/tasks.ts`** (inside `registerTaskTools`, after the write tools)

```ts
server.registerTool(
  'get_task',
  {
    title: 'Get task',
    description: 'Fetch a single task by id (null if not found).',
    inputSchema: { id: z.string() },
  },
  ({ id }) => guard(() => taskService.get(db, id)),
);

server.registerTool(
  'list_tasks',
  {
    title: 'List tasks',
    description: 'List tasks with optional filters.',
    inputSchema: {
      status: z.enum(TASK_STATUSES).optional(),
      projectId: z.string().optional(),
      priority: z.enum(TASK_PRIORITIES).optional(),
      tag: z.string().optional(),
      parentTaskId: z.string().optional(),
      dueBefore: isoDate.optional(),
      dueAfter: isoDate.optional(),
      archived: z.boolean().optional(),
      limit: z.number().int().positive().max(500).optional(),
      sort: z.string().optional(),
    },
  },
  (filters) => guard(() => taskService.list(db, filters)),
);

server.registerTool(
  'search_tasks',
  {
    title: 'Search tasks',
    description: 'Full-text search over task title/description/notes.',
    inputSchema: { q: z.string().min(1), limit: z.number().int().positive().optional() },
  },
  ({ q, limit }) => guard(() => taskService.list(db, { q, limit })),
);
```

> NOTE: `search_tasks` reuses `taskService.list(db, { q })`. If core exposes a dedicated `taskService.search`, call that instead and NOTE it.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @justdoit/mcp test`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @justdoit/mcp typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(mcp): add task read tools (get/list/search)"
```

---

## Task 4: Project & tag tools

**Files:**

- Create: `apps/mcp/src/tools/projects.ts`
- Modify: `apps/mcp/src/tools/index.ts`
- Create: `apps/mcp/src/__tests__/project-tag-tools.test.ts`

**Interfaces:**

- Consumes: `projectService.{create,list}`, `tagService.{create,attach}` (tag create is an upsert-by-name or returns existing; if not, adapter looks up via `tagService.list` first — NOTE the chosen approach).
- Produces: tools `create_project`, `list_projects`, `add_tag`. `add_tag` ensures the tag exists then attaches it to the task, returning `{ task, tag }` or the updated task.

- [ ] **Step 1: Write failing tests — `apps/mcp/src/__tests__/project-tag-tools.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { freshDb, makeClient, firstJson } from './helpers.js';

describe('project tools', () => {
  it('create_project + list_projects', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const proj = firstJson(
      await client.callTool({ name: 'create_project', arguments: { name: 'Work', color: '#f00' } }),
    ) as { id: string; name: string };
    expect(proj.name).toBe('Work');

    const list = firstJson(await client.callTool({ name: 'list_projects', arguments: {} })) as {
      id: string;
    }[];
    expect(list.some((p) => p.id === proj.id)).toBe(true);
  });
});

describe('tag tools', () => {
  it('add_tag attaches a tag to a task', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const task = firstJson(
      await client.callTool({ name: 'create_task', arguments: { title: 'Tagged' } }),
    ) as { id: string };
    const res = firstJson(
      await client.callTool({
        name: 'add_tag',
        arguments: { taskId: task.id, name: 'errands', color: '#0f0' },
      }),
    ) as unknown;
    expect(res).toBeTruthy();

    // Side effect: listing tasks filtered by tag returns the task.
    const byTag = firstJson(
      await client.callTool({ name: 'list_tasks', arguments: { tag: 'errands' } }),
    ) as { id: string }[];
    expect(byTag.some((t) => t.id === task.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @justdoit/mcp test`
Expected: FAIL — project/tag tools unknown.

- [ ] **Step 3: Write `apps/mcp/src/tools/projects.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { projectService, tagService, type Db } from '@justdoit/core';
import { guard } from '../helpers.js';

export function registerProjectTools(server: McpServer, db: Db): void {
  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description: 'Create a project (list) to organize tasks.',
      inputSchema: {
        name: z.string().min(1),
        color: z.string().optional(),
        icon: z.string().optional(),
        description: z.string().optional(),
      },
    },
    (args) => guard(() => projectService.create(db, args)),
  );

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'List projects.',
      inputSchema: { includeArchived: z.boolean().optional() },
    },
    ({ includeArchived }) => guard(() => projectService.list(db, { includeArchived })),
  );

  server.registerTool(
    'add_tag',
    {
      title: 'Add tag to task',
      description: 'Ensure a tag exists and attach it to a task.',
      inputSchema: {
        taskId: z.string(),
        name: z.string().min(1),
        color: z.string().optional(),
      },
    },
    ({ taskId, name, color }) =>
      guard(async () => {
        const tag = await tagService.create(db, { name, color }); // upsert-by-name
        await tagService.attach(db, taskId, tag.id);
        return { taskId, tag };
      }),
  );
}
```

> NOTE: assumes `tagService.create` is idempotent on `name` (the schema marks `tags.name` unique). If it throws on duplicate, change to: look up via `tagService.list(db)`/`getByName`, create only when absent. NOTE the chosen approach in the commit.

- [ ] **Step 4: Wire into `apps/mcp/src/tools/index.ts`**

```ts
import { registerProjectTools } from './projects.js';
// ...inside registerTools:
registerProjectTools(server, db);
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @justdoit/mcp test`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @justdoit/mcp typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat(mcp): add project and tag tools"
```

---

## Task 5: Time-tracking tools (start / stop / log / report)

**Files:**

- Create: `apps/mcp/src/tools/time.ts`
- Modify: `apps/mcp/src/tools/index.ts`
- Create: `apps/mcp/src/__tests__/time-tools.test.ts`

**Interfaces:**

- Consumes: `timeService.{startTimer,stopTimer,logManual}`, `reportService.timeReport`. Clock passed as a trailing positional `now` argument (`new Date()`), per the Phase 2 signatures.
- Produces: tools `start_timer`, `stop_timer`, `log_time`, `get_time_report`.

- [ ] **Step 1: Write failing tests — `apps/mcp/src/__tests__/time-tools.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { timeEntries } from '@justdoit/core';
import { eq } from 'drizzle-orm';
import { freshDb, makeClient, firstJson } from './helpers.js';

async function makeTask(client: Awaited<ReturnType<typeof makeClient>>['client']) {
  return firstJson(
    await client.callTool({ name: 'create_task', arguments: { title: 'Timed' } }),
  ) as { id: string };
}

describe('time tools', () => {
  it('start_timer then stop_timer records an entry', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const task = await makeTask(client);

    await client.callTool({ name: 'start_timer', arguments: { taskId: task.id } });
    const stopped = firstJson(
      await client.callTool({ name: 'stop_timer', arguments: { taskId: task.id } }),
    ) as { endedAt: unknown };
    expect(stopped.endedAt).toBeTruthy();

    const rows = db.select().from(timeEntries).where(eq(timeEntries.taskId, task.id)).all();
    expect(rows).toHaveLength(1);
  });

  it('log_time creates a manual entry', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const task = await makeTask(client);
    const entry = firstJson(
      await client.callTool({
        name: 'log_time',
        arguments: { taskId: task.id, minutes: 30, note: 'design' },
      }),
    ) as { source: string; durationSeconds: number };
    expect(entry.source).toBe('manual');
    expect(entry.durationSeconds).toBe(1800);
  });

  it('get_time_report groups results', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const task = await makeTask(client);
    await client.callTool({ name: 'log_time', arguments: { taskId: task.id, minutes: 15 } });
    const report = firstJson(
      await client.callTool({ name: 'get_time_report', arguments: { groupBy: 'project' } }),
    ) as unknown;
    expect(report).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @justdoit/mcp test`
Expected: FAIL — time tools unknown.

- [ ] **Step 3: Write `apps/mcp/src/tools/time.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { timeService, reportService, type Db } from '@justdoit/core';
import { guard } from '../helpers.js';

const isoDate = z.coerce.date();

export function registerTimeTools(server: McpServer, db: Db): void {
  server.registerTool(
    'start_timer',
    {
      title: 'Start timer',
      description: 'Start a running timer on a task (one running timer enforced by core).',
      inputSchema: { taskId: z.string() },
    },
    ({ taskId }) => guard(() => timeService.startTimer(db, taskId, new Date())),
  );

  server.registerTool(
    'stop_timer',
    {
      title: 'Stop timer',
      description: 'Stop the running timer (defaults to the currently running one).',
      inputSchema: { taskId: z.string().optional() },
    },
    ({ taskId }) => guard(() => timeService.stopTimer(db, { taskId }, new Date())),
  );

  server.registerTool(
    'log_time',
    {
      title: 'Log time',
      description:
        'Record a manual time entry. `minutes` is converted to core `durationSeconds` (minutes × 60) by the handler.',
      inputSchema: {
        taskId: z.string(),
        minutes: z.number().int().positive(),
        startedAt: isoDate.optional(),
        note: z.string().optional(),
      },
    },
    ({ taskId, minutes, startedAt, note }) =>
      guard(() =>
        timeService.logManual(
          db,
          { taskId, startedAt, durationSeconds: minutes * 60, note },
          new Date(),
        ),
      ),
  );

  server.registerTool(
    'get_time_report',
    {
      title: 'Time report',
      description: 'Aggregate tracked time grouped by day, project, or tag.',
      inputSchema: {
        groupBy: z.enum(['day', 'project', 'tag']),
        from: isoDate.optional(),
        to: isoDate.optional(),
      },
    },
    (opts) => guard(() => reportService.timeReport(db, opts)),
  );
}
```

> `stop_timer` passes a ref object `{ taskId }`; when `taskId` is omitted core resolves the single system-wide running entry (Phase 2 `stopTimer(db, ref?, now?)`). `log_time` accepts agent-friendly `minutes` and the handler converts to core's `durationSeconds` (`minutes * 60`) before calling `logManual`.

- [ ] **Step 4: Wire into `apps/mcp/src/tools/index.ts`**

```ts
import { registerTimeTools } from './time.js';
// ...inside registerTools:
registerTimeTools(server, db);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @justdoit/mcp test`
Expected: PASS.
Run: `pnpm --filter @justdoit/mcp typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(mcp): add time-tracking tools (start/stop/log/report)"
```

---

## Task 6: Reminder & quick-add tools

**Files:**

- Create: `apps/mcp/src/tools/misc.ts`
- Modify: `apps/mcp/src/tools/index.ts`
- Create: `apps/mcp/src/__tests__/misc-tools.test.ts`

**Interfaces:**

- Consumes: `reminderService.create`, `quickAddService.create(db, text, now?)`.
- Produces: tools `set_reminder`, `quick_add`. `quick_add` returns the created task; `set_reminder` returns the reminder.

- [ ] **Step 1: Write failing tests — `apps/mcp/src/__tests__/misc-tools.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { reminders } from '@justdoit/core';
import { eq } from 'drizzle-orm';
import { freshDb, makeClient, firstJson } from './helpers.js';

describe('quick_add tool', () => {
  it('parses natural language into a task', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const task = firstJson(
      await client.callTool({
        name: 'quick_add',
        arguments: { text: 'buy milk tomorrow 5pm #errands p1' },
      }),
    ) as { id: string; title: string; priority: string | null };
    expect(task.title.toLowerCase()).toContain('milk');
  });
});

describe('set_reminder tool', () => {
  it('creates a reminder for a task', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const task = firstJson(
      await client.callTool({ name: 'create_task', arguments: { title: 'Remind me' } }),
    ) as { id: string };
    const rem = firstJson(
      await client.callTool({
        name: 'set_reminder',
        arguments: { taskId: task.id, remindAt: '2026-07-09T17:00:00.000Z' },
      }),
    ) as { id: string };
    expect(rem.id).toBeTruthy();

    const rows = db.select().from(reminders).where(eq(reminders.taskId, task.id)).all();
    expect(rows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @justdoit/mcp test`
Expected: FAIL — `quick_add`/`set_reminder` unknown.

- [ ] **Step 3: Write `apps/mcp/src/tools/misc.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { reminderService, quickAddService, type Db } from '@justdoit/core';
import { guard } from '../helpers.js';

const isoDate = z.coerce.date();

export function registerMiscTools(server: McpServer, db: Db): void {
  server.registerTool(
    'quick_add',
    {
      title: 'Quick add',
      description: 'Create a task from natural language, e.g. "buy milk tomorrow 5pm #errands p1".',
      inputSchema: { text: z.string().min(1) },
    },
    ({ text }) => guard(() => quickAddService.create(db, text, new Date())),
  );

  server.registerTool(
    'set_reminder',
    {
      title: 'Set reminder',
      description: 'Schedule a reminder for a task at a given time (ISO 8601).',
      inputSchema: { taskId: z.string(), remindAt: isoDate },
    },
    ({ taskId, remindAt }) => guard(() => reminderService.create(db, { taskId, remindAt })),
  );
}
```

- [ ] **Step 4: Wire into `apps/mcp/src/tools/index.ts`** (final form)

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Db } from '@justdoit/core';
import { registerTaskTools } from './tasks.js';
import { registerProjectTools } from './projects.js';
import { registerTimeTools } from './time.js';
import { registerMiscTools } from './misc.js';

export function registerTools(server: McpServer, db: Db): void {
  registerTaskTools(server, db);
  registerProjectTools(server, db);
  registerTimeTools(server, db);
  registerMiscTools(server, db);
}
```

- [ ] **Step 5: Verify all 17 tools are registered**

Add to `misc-tools.test.ts`:

```ts
it('registers all 17 tools', async () => {
  const { client } = await makeClient(freshDb());
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  expect(names).toEqual(
    [
      'add_tag',
      'complete_task',
      'create_project',
      'create_task',
      'delete_task',
      'get_task',
      'get_time_report',
      'list_projects',
      'list_tasks',
      'log_time',
      'quick_add',
      'search_tasks',
      'set_reminder',
      'set_status',
      'start_timer',
      'stop_timer',
      'update_task',
    ].sort(),
  );
});
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @justdoit/mcp test`
Expected: PASS — including the 17-tool assertion.
Run: `pnpm --filter @justdoit/mcp typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(mcp): add reminder and quick_add tools; assert full tool set"
```

---

## Task 7: Resources (`task://`, `project://`, `tasks://today`, `tasks://overdue`)

**Files:**

- Create: `apps/mcp/src/resources.ts`
- Modify: `apps/mcp/src/server.ts` (call `registerResources`)
- Create: `apps/mcp/src/__tests__/resources.test.ts`

**Interfaces:**

- Consumes: `taskService.{get,list}`, `projectService.get`.
- Produces: `registerResources(server, db)` registering: `task://{id}` and `project://{id}` (parameterized via `ResourceTemplate`), and fixed `tasks://today` / `tasks://overdue`. Each returns a `contents` array of `{ uri, mimeType: 'application/json', text }`.

- [ ] **Step 1: Write failing tests — `apps/mcp/src/__tests__/resources.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { freshDb, makeClient, firstJson } from './helpers.js';

function readJson(result: { contents: { text?: string }[] }): unknown {
  const text = result.contents[0]?.text;
  return text ? JSON.parse(text) : undefined;
}

describe('resources', () => {
  it('lists the fixed resources', async () => {
    const { client } = await makeClient(freshDb());
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain('tasks://today');
    expect(uris).toContain('tasks://overdue');
  });

  it('reads a task by uri', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const task = firstJson(
      await client.callTool({ name: 'create_task', arguments: { title: 'Resource me' } }),
    ) as { id: string };
    const res = await client.readResource({ uri: `task://${task.id}` });
    const body = readJson(res) as { title: string };
    expect(body.title).toBe('Resource me');
  });

  it('reads overdue tasks', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    await client.callTool({
      name: 'create_task',
      arguments: { title: 'Past due', dueAt: '2020-01-01T00:00:00.000Z', status: 'todo' },
    });
    const res = await client.readResource({ uri: 'tasks://overdue' });
    const body = readJson(res) as { title: string }[];
    expect(body.some((t) => t.title === 'Past due')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @justdoit/mcp test`
Expected: FAIL — resources not registered.

- [ ] **Step 3: Write `apps/mcp/src/resources.ts`**

```ts
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { taskService, projectService, type Db } from '@justdoit/core';

function jsonContents(uri: string, value: unknown) {
  return {
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }],
  };
}

function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
function endOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

export function registerResources(server: McpServer, db: Db): void {
  server.registerResource(
    'task',
    new ResourceTemplate('task://{id}', { list: undefined }),
    { title: 'Task', description: 'A single task by id', mimeType: 'application/json' },
    async (uri, { id }) => jsonContents(uri.href, await taskService.get(db, String(id))),
  );

  server.registerResource(
    'project',
    new ResourceTemplate('project://{id}', { list: undefined }),
    { title: 'Project', description: 'A single project by id', mimeType: 'application/json' },
    async (uri, { id }) => jsonContents(uri.href, await projectService.get(db, String(id))),
  );

  server.registerResource(
    'tasks-today',
    'tasks://today',
    { title: "Today's tasks", description: 'Tasks due today', mimeType: 'application/json' },
    async (uri) => {
      const now = new Date();
      const tasks = await taskService.list(db, {
        dueAfter: startOfDay(now),
        dueBefore: endOfDay(now),
      });
      return jsonContents(uri.href, tasks);
    },
  );

  server.registerResource(
    'tasks-overdue',
    'tasks://overdue',
    {
      title: 'Overdue tasks',
      description: 'Incomplete tasks past their due date',
      mimeType: 'application/json',
    },
    async (uri) => {
      const tasks = await taskService.list(db, { dueBefore: new Date(), status: 'todo' });
      return jsonContents(uri.href, tasks);
    },
  );
}
```

> NOTE: `tasks://overdue` should exclude `done`/`cancelled`. If `taskService.list` supports a "not in status" filter or an `incomplete: true` flag, use it; the `status: 'todo'` above is a placeholder that only captures todo. Prefer a core filter like `statusNotIn: ['done','cancelled']` and NOTE the exact filter used. `ResourceTemplate` `{ list: undefined }` means the template is read-only (no enumeration); adjust if the SDK signature differs.

- [ ] **Step 4: Wire into `apps/mcp/src/server.ts`**

```ts
import { registerResources } from './resources.js';
// ...after registerTools(server, db):
registerResources(server, db);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @justdoit/mcp test`
Expected: PASS.
Run: `pnpm --filter @justdoit/mcp typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(mcp): add task/project/today/overdue resources"
```

---

## Task 8: Prompts (`plan_my_day`, `summarize_progress`)

**Files:**

- Create: `apps/mcp/src/prompts.ts`
- Modify: `apps/mcp/src/server.ts`
- Create: `apps/mcp/src/__tests__/prompts.test.ts`

**Interfaces:**

- Consumes: nothing from core directly — prompts return message templates that instruct the agent to use the tools/resources above.
- Produces: `registerPrompts(server)` registering `plan_my_day` and `summarize_progress`, each returning `{ messages: [...] }`.

- [ ] **Step 1: Write failing tests — `apps/mcp/src/__tests__/prompts.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { freshDb, makeClient } from './helpers.js';

describe('prompts', () => {
  it('lists both prompts', async () => {
    const { client } = await makeClient(freshDb());
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name).sort();
    expect(names).toEqual(['plan_my_day', 'summarize_progress']);
  });

  it('plan_my_day returns a user message', async () => {
    const { client } = await makeClient(freshDb());
    const res = await client.getPrompt({ name: 'plan_my_day', arguments: {} });
    expect(res.messages.length).toBeGreaterThan(0);
    expect(res.messages[0].role).toBe('user');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @justdoit/mcp test`
Expected: FAIL — prompts not registered.

- [ ] **Step 3: Write `apps/mcp/src/prompts.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

function userText(text: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'plan_my_day',
    {
      title: 'Plan my day',
      description: 'Draft a focused plan from today and overdue tasks.',
      argsSchema: { focus: z.string().optional() },
    },
    ({ focus }) =>
      userText(
        [
          'Plan my day. Read the `tasks://today` and `tasks://overdue` resources and the',
          '`list_tasks` tool to see in-progress work. Propose an ordered, realistic plan',
          'that respects priorities (p0 first) and due dates, calling out anything overdue.',
          focus ? `Focus especially on: ${focus}.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      ),
  );

  server.registerPrompt(
    'summarize_progress',
    {
      title: 'Summarize progress',
      description: 'Summarize what was completed and time spent in a period.',
      argsSchema: { period: z.string().optional() },
    },
    ({ period }) =>
      userText(
        [
          `Summarize my progress${period ? ` for ${period}` : ' recently'}.`,
          'Use `list_tasks` (status done) and `get_time_report` to report completed tasks,',
          'time spent by project, and anything still blocked or overdue.',
        ].join(' '),
      ),
  );
}
```

> NOTE: prompt message content shape (`{ role, content: { type: 'text', text } }`) matches the SDK's `GetPromptResult`. If the installed SDK uses a different content shape, adapt while keeping `role: 'user'` and the text intact.

- [ ] **Step 4: Wire into `apps/mcp/src/server.ts`** (final form)

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Db } from '@justdoit/core';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';

export function createMcpServer(db: Db): McpServer {
  const server = new McpServer({ name: 'justdoit', version: '0.0.0' });
  registerTools(server, db);
  registerResources(server, db);
  registerPrompts(server);
  return server;
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @justdoit/mcp test`
Expected: PASS.
Run: `pnpm --filter @justdoit/mcp typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(mcp): add plan_my_day and summarize_progress prompts"
```

---

## Task 9: Transports (stdio + streamable-HTTP) & config docs

**Files:**

- Create: `apps/mcp/src/stdio.ts`
- Create: `apps/mcp/src/http.ts`
- Create: `apps/mcp/README.md`
- Modify: root `turbo.json` (no change needed if `typecheck`/`test` are globless; confirm mcp is picked up)

**Interfaces:**

- Consumes: `createMcpServer`, `createDb`, `runMigrations` from core; env `JUSTDOIT_DB`, `JUSTDOIT_API_KEY`, `JUSTDOIT_MCP_PORT`.
- Produces:
  - `src/stdio.ts` — shebang bin entry; opens the DB, runs migrations, connects `StdioServerTransport`.
  - `src/http.ts` — HTTP server on `JUSTDOIT_MCP_PORT` (default `3939`) using `StreamableHTTPServerTransport`; if `JUSTDOIT_API_KEY` set, requires matching `Authorization: Bearer <key>` or `X-API-Key: <key>` (401 otherwise).
  - `README.md` with the `mcpServers` registration snippet.

- [ ] **Step 1: Write `apps/mcp/src/stdio.ts`**

```ts
#!/usr/bin/env -S npx tsx
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDb, runMigrations } from '@justdoit/core';
import { createMcpServer } from './server.js';

const dbPath = process.env.JUSTDOIT_DB ?? 'justdoit.db';
const { db } = createDb(dbPath);
runMigrations(db);

const server = createMcpServer(db);
const transport = new StdioServerTransport();
await server.connect(transport);
// stdio: do not write to stdout; logs go to stderr.
process.stderr.write(`justdoit MCP (stdio) ready — db=${dbPath}\n`);
```

> NOTE: the shebang `env -S npx tsx` lets the `bin` run directly; when registered in a harness we instead invoke `tsx`/`node` explicitly (Step 3), so the shebang is a convenience only. Keep all non-protocol logging on stderr — stdout is the MCP channel.

- [ ] **Step 2: Write `apps/mcp/src/http.ts`**

```ts
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createDb, runMigrations } from '@justdoit/core';
import { createMcpServer } from './server.js';

const dbPath = process.env.JUSTDOIT_DB ?? 'justdoit.db';
const apiKey = process.env.JUSTDOIT_API_KEY; // optional
const port = Number(process.env.JUSTDOIT_MCP_PORT ?? 3939);

const { db } = createDb(dbPath);
runMigrations(db);

function authorized(req: import('node:http').IncomingMessage): boolean {
  if (!apiKey) return true; // auth disabled when unset
  const bearer = req.headers['authorization'];
  const header = req.headers['x-api-key'];
  return bearer === `Bearer ${apiKey}` || header === apiKey;
}

const server = createMcpServer(db);
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});
await server.connect(transport);

const http = createServer((req, res) => {
  if (!authorized(req)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  transport.handleRequest(req, res).catch((err) => {
    res.writeHead(500);
    res.end(String(err));
  });
});

http.listen(port, () => {
  process.stderr.write(
    `justdoit MCP (http) on :${port} — db=${dbPath}, auth=${apiKey ? 'on' : 'off'}\n`,
  );
});
```

> NOTE: `StreamableHTTPServerTransport` needs the raw request body; `handleRequest(req, res)` reads it internally in recent SDK versions. If the installed version expects a pre-parsed body (`handleRequest(req, res, parsedBody)`), buffer the body first. A single shared transport/session is fine for single-user localhost; for multi-session, key transports by the `mcp-session-id` header. NOTE the version's exact contract.

- [ ] **Step 3: Write `apps/mcp/README.md` (harness config docs)**

````md
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
````

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

````

- [ ] **Step 4: Smoke-run stdio (manual verification)**

Run: `JUSTDOIT_DB=:memory: pnpm --filter @justdoit/mcp start`
Expected: prints `justdoit MCP (stdio) ready — db=:memory:` to stderr and blocks waiting on stdin. Ctrl-C to exit.

> NOTE: `:memory:` won't persist; use a file path for real use. This step only confirms the entry boots.

- [ ] **Step 5: Smoke-run HTTP + auth (manual verification)**

Run (terminal A): `JUSTDOIT_DB=:memory: JUSTDOIT_API_KEY=secret pnpm --filter @justdoit/mcp start:http`
Run (terminal B): `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3939`
Expected: `401` (no key). With `-H "X-API-Key: secret"` the request is accepted by the transport (status depends on MCP handshake; not 401).

- [ ] **Step 6: Full workspace gates**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: all PASS (mcp tests included via Turbo).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(mcp): add stdio + streamable-HTTP entrypoints and harness config docs"
````

---

## Phase 4 Definition of Done

- `@justdoit/mcp` exists in the workspace, imports `@justdoit/core` in-process (never over HTTP), and builds/typechecks clean.
- `createMcpServer(db: Db): McpServer` registers all **17 tools**, **4 resources**, and **2 prompts**, and is exercised in-process via `InMemoryTransport` + `Client`.
- Every tool test asserts both the tool result content **and** the DB side effect (row inserted/updated/deleted) against an in-memory `createDb(':memory:')` + `runMigrations` database.
- Tools are thin: each validates with a zod raw shape (reusing/deriving from core schemas) and calls exactly one core service; no business logic in the adapter. Errors surface as `isError` results.
- Resources resolve `task://{id}`, `project://{id}`, `tasks://today`, `tasks://overdue`; prompts `plan_my_day` and `summarize_progress` return message templates.
- `src/stdio.ts` (bin) and `src/http.ts` boot from `JUSTDOIT_DB`; HTTP enforces `JUSTDOIT_API_KEY` (bearer or `X-API-Key`) when set, else open.
- `apps/mcp/README.md` documents the `mcpServers` stdio registration snippet (command `tsx`/`pnpm`, args, `JUSTDOIT_DB` env) and the HTTP option.
- `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` all pass at the repo root.

## Notes for later phases

- **Shared auth key.** `JUSTDOIT_API_KEY` gates both the MCP HTTP transport (this phase) and the REST API's `X-API-Key` (Phase 1). Keep the env var name identical so a single key gates both surfaces.
- **Multi-session HTTP.** The single-transport HTTP entry suits single-user localhost. If multiple concurrent MCP sessions are needed, key `StreamableHTTPServerTransport` instances by the `mcp-session-id` header and route accordingly.
- **Schema drift.** Tool raw shapes were derived from/aligned with core Zod schemas where present, else defined inline (see per-task NOTEs). Any inline shape flags a candidate core schema to backfill so REST/MCP/UI reuse one definition (design principle "type-safe end to end").
- **Overdue filter.** `tasks://overdue` needs a "status not in (done, cancelled)" filter. If Phase 1's `taskService.list` lacks it, add that filter in core and update the resource; do not encode the rule in the adapter.
- **Production build.** Like Phase 0, mcp runs from TS source via `tsx` in dev. A bundling step (e.g. `tsup`) for a distributable `justdoit-mcp` binary is deferred until packaging is needed; the `bin` shebang is a dev convenience.
- **Prompt/tool contract stability.** If the installed `@modelcontextprotocol/sdk` version differs from the assumed `registerTool`/`registerResource`/`registerPrompt` signatures, adapt the registration calls but keep tool names, params, resource URIs, and prompt names exactly as specified so downstream harness configs remain valid.
