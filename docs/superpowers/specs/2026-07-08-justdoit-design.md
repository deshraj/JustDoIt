# justdoit — Design Spec

**Status:** Approved for planning
**Date:** 2026-07-08
**Owner:** deshraj

## 1. Summary

`justdoit` is a **local-first personal task manager** with three surfaces over one shared core:

1. **REST API** — the canonical, headless HTTP interface.
2. **MCP server** — lets an agent harness manage tasks directly.
3. **Next.js UI** — a sleek, minimal, keyboard-first web app.

It tracks to-dos, their status lifecycle, and time spent, with organization
(projects, tags, priorities, subtasks), scheduling (due dates, recurrence,
reminders), time tracking (timers, estimates vs actuals, reports), and rich
content (markdown, attachments, activity history, board/calendar views).

Single-user, runs on localhost. Data lives in one SQLite file.

## 2. Design principles

- **One core, thin adapters.** ALL business logic and validation lives in
  `packages/core`. REST, MCP, and UI are thin adapters — an agent and a UI click
  hit the exact same validated code path. No business rules in adapters.
- **Local-first & self-sufficient.** SQLite file, zero external services. The MCP
  server imports `core` in-process, so agents work even when the API/UI is down.
- **Sleek & minimal UI.** Keyboard-first, uncluttered, fast. Dark mode. Command
  palette (⌘K). Natural-language quick-add. Minimal chrome, generous whitespace.
- **Type-safe end to end.** TypeScript everywhere; Zod schemas defined once in
  `core` and reused by REST, MCP, and UI.
- **TDD.** Core logic is developed test-first with Vitest.

## 3. Architecture

```
justdoit/  (pnpm workspace + Turborepo)
├── packages/
│   └── core/          # domain logic, Drizzle schema+migrations, SQLite access,
│                      # Zod schemas, services. ALL business rules. Unit-tested.
├── apps/
│   ├── api/           # Hono HTTP server → REST API (canonical headless surface)
│   ├── mcp/           # MCP server (@modelcontextprotocol/sdk) → imports core directly
│   └── web/           # Next.js 15 (App Router) UI → consumes the REST API
├── justdoit.db        # single SQLite file (backup = copy the file)
└── docs/
```

**Key architectural decisions:**

- **MCP imports `core` directly** (not over HTTP). Self-sufficient; no network hop.
  Exposes both **stdio** (local agent harness) and **streamable-HTTP** transports.
- **REST is a standalone Hono server**, not Next.js route handlers. Keeps REST a
  first-class headless surface runnable without the UI; keeps the UI a pure client.
- **Data path:** UI → REST (over HTTP) → core; MCP → core (in-process). Both
  converge on `core` services, which own all validation and side effects.

### Stack

| Concern            | Choice                                                            |
| ------------------ | ----------------------------------------------------------------- |
| Language           | TypeScript (strict)                                               |
| Monorepo           | pnpm workspaces + Turborepo                                       |
| DB / ORM           | SQLite (`better-sqlite3`) + Drizzle ORM + Drizzle Kit migrations  |
| Validation         | Zod (schemas defined in `core`, shared everywhere)                |
| REST server        | Hono                                                              |
| MCP                | `@modelcontextprotocol/sdk` (stdio + streamable-HTTP)             |
| UI                 | Next.js 15 App Router, React, Tailwind, shadcn/ui, TanStack Query |
| Scheduler / notify | `node-cron` + `node-notifier` (in API process)                    |
| Tests              | Vitest (+ Playwright for UI e2e in Phase 5)                       |
| Tooling            | ESLint, Prettier, tsc, Turborepo pipelines                        |

## 4. Data model

All tables have `id` (uuid/text), `created_at`, `updated_at`.

### Task

- `title` (string, required)
- `description` (markdown text)
- `status` — enum: `backlog | todo | in_progress | blocked | done | cancelled`
- `priority` — enum: `p0 | p1 | p2 | p3` (nullable)
- `project_id` → Project (nullable → "Inbox")
- `parent_task_id` → Task (nullable; enables subtasks, one level enforced in v1)
- `position` (float/int for manual ordering within a project/status)
- `due_at`, `start_at` (nullable timestamps)
- `estimate_minutes` (int, nullable)
- `recurrence` (RRULE string, nullable)
- `completed_at` (nullable)
- `archived` (bool)

### Project (list)

- `name`, `color`, `icon`, `description`, `position`, `archived`

### Tag

- `name`, `color`; many-to-many with Task via `task_tags`

### TimeEntry

- `task_id`, `started_at`, `ended_at` (nullable while running),
  `duration_seconds` (derived/stored), `note`, `source` (`timer | manual`)

### Reminder

- `task_id`, `remind_at`, `delivered` (bool)

### ActivityLog

- `entity_type`, `entity_id`, `action`, `payload` (JSON), `created_at` — audit trail

### Attachment

- `task_id`, `filename`, `path` (local), `mime`, `size`

### SavedFilter

- `name`, `query` (JSON: filters/sort/grouping for a saved view)

**Status lifecycle:** fixed enum in v1. `done`/`cancelled` set `completed_at`.
Completing a recurring task spawns the next occurrence from its RRULE.

## 5. Surfaces

### 5.1 REST API (`apps/api`, Hono)

- `GET/POST /tasks`, `GET/PATCH/DELETE /tasks/:id`
- `PATCH /tasks/:id/status`, `POST /tasks/:id/complete`
- `GET/POST /tasks/:id/subtasks`
- `POST /tasks/:id/timer/start`, `POST /tasks/:id/timer/stop`
- `GET/POST /time-entries`, `PATCH/DELETE /time-entries/:id`
- `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`
- `GET/POST /tags`, `PATCH/DELETE /tags/:id`
- `GET/POST /reminders`, `PATCH/DELETE /reminders/:id`
- `GET /search?q=` — full-text over title/description/notes
- `GET /reports/time?group_by=day|project|tag&from=&to=`
- `GET /activity`
- `POST /quick-add` — natural-language parse → task (`"buy milk tomorrow 5pm #errands p1"`)
- `GET /export`, `POST /import` — JSON backup/restore
- Filtering/sorting via query params (status, project, tag, priority, due range, etc.)
- **Auth:** optional `X-API-Key` header. Off by default on localhost; enabled via
  config for agent access. Same key gates the MCP HTTP transport.
- **Live updates:** `GET /events` (SSE) broadcasting task/project changes (Phase 6).

### 5.2 MCP server (`apps/mcp`)

**Tools:** `create_task`, `update_task`, `list_tasks` (filters), `get_task`,
`set_status`, `complete_task`, `delete_task`, `start_timer`, `stop_timer`,
`log_time`, `create_project`, `list_projects`, `add_tag`, `search_tasks`,
`get_time_report`, `set_reminder`, `quick_add`.

**Resources:** `task://{id}`, `project://{id}`, `tasks://today`, `tasks://overdue`
so the agent can read task context as resources.

**Prompts:** e.g. `plan_my_day`, `summarize_progress` (optional, Phase 4).

Transports: **stdio** (default for local harness) and **streamable-HTTP**.

### 5.3 Next.js UI (`apps/web`)

- **Views:** List, Kanban board (drag-drop across status columns), Calendar.
- **Task detail:** markdown description, subtasks/checklist, inline timer,
  tags, priority, due/start, attachments, activity history.
- **Quick-add bar** with natural-language parsing.
- **Command palette (⌘K):** jump to task/project, run actions, switch views.
- **Search + saved filters/views.**
- **Analytics dashboard:** time per day/project/tag, estimate vs actual,
  throughput (completed/day), current streak.
- **Bulk actions:** multi-select → status/priority/project/tag/delete.
- **Aesthetic:** minimal, keyboard-first, dark mode, generous whitespace,
  subtle motion. shadcn/ui + Tailwind.

## 6. Build phases

Each phase is its own spec-detail → implementation-plan → build cycle.

- **Phase 0 — Foundation.** Monorepo scaffold (pnpm+Turbo), TS/lint/format config,
  Drizzle schema + first migration, `core` package skeleton + DB bootstrap, Vitest
  harness, CI-ready scripts.
- **Phase 1 — Core + REST.** Tasks, status lifecycle, projects, tags, priorities,
  subtasks, markdown notes. Full `core` services (TDD) + REST CRUD + filtering +
  `quick-add` parser + JSON import/export.
- **Phase 2 — Time tracking.** Timers (start/stop, single running enforced),
  manual entries, estimates vs actuals, `/reports/time`.
- **Phase 3 — Scheduling.** Due/start dates, recurring tasks (RRULE, spawn-next),
  reminders + `node-cron` scheduler + desktop notifications.
- **Phase 4 — MCP server.** Tools + resources + prompts over `core`; stdio +
  HTTP transports; auth; config docs for connecting an agent harness.
- **Phase 5 — Next.js UI.** List/board/calendar, task detail, quick-add, command
  palette, search, analytics dashboard; TanStack Query data layer; Playwright e2e.
- **Phase 6 — Polish.** Saved filters, bulk actions, activity log UI, attachments,
  SSE live sync across surfaces, keyboard-shortcut cheatsheet, empty/onboarding states.

## 7. Testing strategy

- **`core`:** unit tests (Vitest) for every service, test-first. In-memory SQLite.
- **REST:** integration tests hitting Hono routes against a temp DB.
- **MCP:** tool-call tests invoking the server programmatically.
- **UI:** component tests + Playwright e2e for critical flows (Phase 5).

## 8. Out of scope (future)

Multi-user/collaboration & sharing, mobile/native apps, third-party calendar
(Google/Apple) sync, cloud hosting/sync, custom statuses/workflows. Noted so the
data model stays forward-compatible but the build stays focused.

## 9. Open questions

None blocking. Custom statuses, calendar sync, and cloud sync are explicitly
deferred (Section 8).
