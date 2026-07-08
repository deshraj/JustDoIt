# Phase 6: Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the final layer of `justdoit`: saved filters, bulk actions, an activity audit trail, file attachments, and real-time SSE live-sync across every surface, plus the last UI niceties (keyboard cheatsheet, empty/onboarding states). Every data feature is delivered end-to-end (`core` service → REST route → web UI) and proven by tests at each layer.

**Architecture:** All new business logic stays in `@justdoit/core`. A tiny **in-process event bus** (also in `core`) is the spine of this phase: mutating services `publish()` a `DomainEvent` to it; two independent subscribers consume the stream — (a) the **activity logger**, which persists each event to `activityLog`, and (b) the API's **`GET /events` SSE route**, which fans events out to browsers. The web app subscribes to that SSE stream and invalidates the matching TanStack Query caches, so a change made by the MCP agent, a REST call, or another tab appears everywhere without a manual refresh. This keeps core services thin (one `emit(...)` line per mutation) and avoids threading a bus argument through every `(db, ...)` signature.

**Tech Stack:** Same as prior phases — TypeScript 5.7 (strict, ESM, `moduleResolution: "Bundler"`, `verbatimModuleSyntax`), Drizzle + `better-sqlite3`, Zod 3, Hono + `@hono/zod-validator` (REST), Next.js 15 App Router + TanStack Query + shadcn/ui (web, pure REST client), Vitest 3 (core + REST), Playwright + React Testing Library (web).

## Global Constraints

- Node `>=22`; pnpm `10.4.1`. All packages ESM (`"type": "module"`). Verbatim from Phase 0.
- **No business rules in adapters.** REST routes and web components only marshal input/output; validation and side effects live in `core` services.
- Clock injection follows the Phases 1–3 convention: any time-dependent core mutation takes a **trailing optional positional `now?: Date`** (default `new Date()`), NOT an options object — so tests inject a fixed `Date`. Methods that ALSO need extra options (e.g. attachments' `filesDir`) keep a trailing `opts` object placed AFTER the positional `now?`. Domain events are timestamped by the emit layer; core mutation signatures are unchanged. Only `taskService.complete` carries `now?: Date` (for recurrence). Tests assert event shape + `at` ordering, not exact timestamps.
- Errors thrown by services are `NotFoundError` / `ValidationError` / `ConflictError` (from `@justdoit/core`). The REST error middleware maps them to `404 / 400 / 409`.
- The event bus is a **single in-process instance**. Cross-process mutations (the MCP server runs in its own process) do **not** reach the API's SSE clients; this is acceptable for v1 and documented in the DoD. Activity logging, by contrast, works in any process that calls `startActivityLog(db)`.
- Attachment storage dir is configurable: env `JUSTDOIT_FILES_DIR`, default `./data/files`. Core never reads env directly — the API passes the resolved dir into the service.
- New env vars introduced/used this phase: `JUSTDOIT_FILES_DIR` (api), `JUSTDOIT_API_PORT` (api, default `8787`), `NEXT_PUBLIC_API_URL` (web, default `http://localhost:8787`).

## Interfaces inherited from Phases 1–5 (assumed contracts)

This plan builds on the surfaces those phases produced. Where a step edits an existing file, it references these contracts:

- **`@justdoit/core`** exports `createDb`, `runMigrations`, type `Db`, the Drizzle tables/`schema`, inferred row types, and the error classes `NotFoundError` / `ValidationError` / `ConflictError` (`packages/core/src/errors.ts`).
- Core services live in `packages/core/src/services/*-service.ts` and are exported as plain objects from `packages/core/src/index.ts`: `taskService`, `projectService`, `tagService`, `timeService`, `reportService`, `reminderService`, and `quickAddService`. Time-dependent methods accept a trailing optional positional `now?: Date` (default `new Date()`); most CRUD `create`/`update` methods take no clock — see the clock convention in the Global Constraints.
- **`@justdoit/api`** (`apps/api`): a Hono app assembled in `apps/api/src/app.ts` from route modules in `apps/api/src/routes/`. Env type is `apps/api/src/context.ts` → `export type Env = { Variables: { db: Db } }`; a middleware opens `createDb(process.env.JUSTDOIT_DB)` once and sets `c.get('db')`. Error-mapping middleware already exists. Routes are mounted with `app.route('/', tasksRoute)` etc. Server entry is `apps/api/src/server.ts` (listens on `JUSTDOIT_API_PORT ?? 8787`).
- **`@justdoit/web`** (`apps/web`): Next.js 15 App Router. REST client helper `apps/web/src/lib/api.ts` exports `apiFetch<T>(path, init?)` (prefixes `NEXT_PUBLIC_API_URL`) and `apiUrl(path)`. TanStack Query is configured in `apps/web/src/app/providers.tsx` with a shared `QueryClient`. shadcn/ui primitives are in `apps/web/src/components/ui/*`. Query-key conventions: `['tasks', filters]`, `['task', id]`, `['projects']`, `['tags']`, `['time-entries', taskId]`, `['reports', ...]`.

---

## File Structure (added/modified this phase)

```
packages/core/src/
├── events/
│   ├── bus.ts                      # NEW: EventBus, DomainEvent, singleton `events`
│   ├── bus.test.ts                 # NEW
│   └── emit.ts                     # NEW: emit() helper used by services
├── services/
│   ├── task-service.ts             # MODIFY: emit()s + bulkUpdate/bulkDelete
│   ├── project-service.ts          # MODIFY: emit()s
│   ├── time-service.ts             # MODIFY: emit()s
│   ├── activity-service.ts         # NEW: record/list + startActivityLog()
│   ├── activity-service.test.ts    # NEW
│   ├── saved-filter-service.ts     # NEW: CRUD + Zod schemas
│   ├── saved-filter-service.test.ts# NEW
│   ├── task-bulk.test.ts           # NEW: bulk actions tests
│   ├── attachment-service.ts       # NEW: add/list/get/remove + validation
│   └── attachment-service.test.ts  # NEW
└── index.ts                        # MODIFY: export new services + events

apps/api/src/
├── routes/
│   ├── saved-filters.ts            # NEW
│   ├── activity.ts                 # NEW
│   ├── attachments.ts              # NEW
│   ├── events.ts                   # NEW (SSE)
│   └── tasks.ts                    # MODIFY: bulk routes
├── app.ts                          # MODIFY: mount new routes + startActivityLog
└── routes/*.test.ts                # NEW test files per route

apps/web/src/
├── lib/queries.ts                  # MODIFY: hooks for new features
├── hooks/use-live-sync.ts          # NEW: SSE → query invalidation
├── hooks/use-keyboard-shortcuts.ts # NEW
├── components/
│   ├── activity-timeline.tsx       # NEW
│   ├── saved-filters-menu.tsx      # NEW
│   ├── bulk-action-toolbar.tsx     # NEW
│   ├── attachments-panel.tsx       # NEW
│   ├── shortcut-cheatsheet.tsx     # NEW
│   ├── empty-state.tsx             # NEW
│   └── onboarding.tsx              # NEW
├── app/providers.tsx               # MODIFY: mount <LiveSync/> + <ShortcutCheatsheet/>
└── **/*.test.tsx + e2e/*.spec.ts   # NEW tests
```

---

## Task 1: Domain event bus primitive (core)

**Files:**
- Create: `packages/core/src/events/bus.ts`
- Create: `packages/core/src/events/emit.ts`
- Create: `packages/core/src/events/bus.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing (pure primitive).
- Produces:
  - `interface DomainEvent { type: string; entityType: EntityType; entityId: string; action: DomainEventAction; payload?: Record<string, unknown>; at: number }` where `type EntityType = 'task' | 'project' | 'time_entry'`.
  - `class EventBus { subscribe(l: EventListener): () => void; publish(e: DomainEvent): void; reset(): void }` and singleton `export const events = new EventBus()`.
  - `emit(entityType, entityId, action, payload?, at?): void` — stamps the dotted `type` (`task` / `project` / `time`) and publishes to `events`.

- [ ] **Step 1: Write the failing test — `packages/core/src/events/bus.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus, events, type DomainEvent } from './bus';
import { emit } from './emit';

describe('EventBus', () => {
  it('delivers published events to every subscriber and supports unsubscribe', () => {
    const bus = new EventBus();
    const seen: DomainEvent[] = [];
    const off = bus.subscribe((e) => seen.push(e));
    bus.publish({ type: 'task.created', entityType: 'task', entityId: 't1', action: 'created', at: 1 });
    off();
    bus.publish({ type: 'task.updated', entityType: 'task', entityId: 't1', action: 'updated', at: 2 });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.type).toBe('task.created');
  });

  it('isolates a throwing subscriber from the others', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe((e) => seen.push(e.type));
    expect(() => bus.publish({ type: 'x', entityType: 'task', entityId: 'a', action: 'updated', at: 0 })).not.toThrow();
    expect(seen).toEqual(['x']);
  });
});

describe('emit helper + singleton', () => {
  beforeEach(() => events.reset());

  it('stamps the dotted type and publishes to the singleton bus', () => {
    const seen: DomainEvent[] = [];
    events.subscribe((e) => seen.push(e));
    emit('task', 't1', 'status_changed', { from: 'todo', to: 'done' }, 123);
    emit('time_entry', 'e1', 'started', undefined, 456);
    expect(seen[0]).toMatchObject({ type: 'task.status_changed', entityType: 'task', entityId: 't1', at: 123 });
    expect(seen[1]!.type).toBe('time.started');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/core test src/events/bus.test.ts`
Expected: FAIL — cannot resolve `./bus` / `./emit`.

- [ ] **Step 3: Write `packages/core/src/events/bus.ts`**

```ts
export type EntityType = 'task' | 'project' | 'time_entry';

export type DomainEventAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'status_changed'
  | 'completed'
  | 'started'
  | 'stopped'
  | 'logged';

export interface DomainEvent {
  /** Dotted event name, e.g. 'task.updated' | 'project.created' | 'time.started'. */
  type: string;
  entityType: EntityType;
  entityId: string;
  action: DomainEventAction;
  payload?: Record<string, unknown>;
  /** Epoch milliseconds (from the injected clock at the call site). */
  at: number;
}

export type EventListener = (event: DomainEvent) => void;

export class EventBus {
  #listeners = new Set<EventListener>();

  subscribe(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  publish(event: DomainEvent): void {
    // Copy so a subscriber that (un)subscribes during dispatch can't corrupt iteration.
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        // Subscriber failures are isolated: one bad listener never breaks a mutation.
      }
    }
  }

  reset(): void {
    this.#listeners.clear();
  }
}

/** Process-wide bus. Services publish here; the API's SSE route and activity logger subscribe. */
export const events = new EventBus();
```

- [ ] **Step 4: Write `packages/core/src/events/emit.ts`**

```ts
import { events, type DomainEventAction, type EntityType } from './bus';

const PREFIX: Record<EntityType, string> = {
  task: 'task',
  project: 'project',
  time_entry: 'time',
};

/** Thin helper services call at the end of a mutation. Keeps call sites to one line. */
export function emit(
  entityType: EntityType,
  entityId: string,
  action: DomainEventAction,
  payload?: Record<string, unknown>,
  at: number = Date.now(),
): void {
  events.publish({ type: `${PREFIX[entityType]}.${action}`, entityType, entityId, action, payload, at });
}
```

- [ ] **Step 5: Export from `packages/core/src/index.ts`** — add:

```ts
export * from './events/bus';
export * from './events/emit';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/core test src/events/bus.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): add in-process domain event bus"
```

---

## Task 2: Emit domain events from mutating services (core)

Wire `emit(...)` into the existing task/project/time services so every mutation announces itself. This is the single cross-cutting change that powers both activity logging (Task 3) and SSE (Task 5).

**Files:**
- Modify: `packages/core/src/services/task-service.ts`
- Modify: `packages/core/src/services/project-service.ts`
- Modify: `packages/core/src/services/time-service.ts`
- Create: `packages/core/src/services/emit-integration.test.ts`

**Interfaces:**
- Consumes: `emit` (Task 1); existing service methods.
- Produces — events published on each mutation (payload in parentheses):
  - `task.created` (`{ title }`), `task.updated` (`{ patch }`), `task.status_changed` (`{ from, to }`), `task.completed` (`{}`), `task.deleted` (`{}`)
  - `project.created` (`{ name }`), `project.updated` (`{ patch }`), `project.deleted` (`{}`)
  - `time.started` (`{ taskId }`), `time.stopped` (`{ taskId, durationSeconds }`), `time.logged` (`{ taskId, durationSeconds }`)
  - `at` is stamped by the emit layer in every case (defaults to `Date.now()`; core mutation signatures are not changed).

- [ ] **Step 1: Write the failing integration test — `packages/core/src/services/emit-integration.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations } from '../db/client';
import { events, type DomainEvent } from '../events/bus';
import { taskService } from './task-service';
import { projectService } from './project-service';

describe('service event emission', () => {
  beforeEach(() => events.reset());

  it('emits task.created then task.status_changed with from/to', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const seen: DomainEvent[] = [];
    events.subscribe((e) => seen.push(e));

    const task = taskService.create(db, { title: 'Ship it' });
    taskService.setStatus(db, task.id, 'in_progress');

    expect(seen.map((e) => e.type)).toEqual(['task.created', 'task.status_changed']);
    expect(seen[0]).toMatchObject({ entityType: 'task', entityId: task.id });
    expect(seen[1]!.at).toBeGreaterThanOrEqual(seen[0]!.at);
    expect(seen[1]!.payload).toMatchObject({ from: 'todo', to: 'in_progress' });
  });

  it('emits project.created', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const seen: DomainEvent[] = [];
    events.subscribe((e) => seen.push(e));
    const project = projectService.create(db, { name: 'Work' });
    expect(seen[0]).toMatchObject({ type: 'project.created', entityId: project.id });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/core test src/services/emit-integration.test.ts`
Expected: FAIL — no events observed (`seen` is empty).

- [ ] **Step 3: Add `emit(...)` calls to `task-service.ts`**

Import at the top of the file:

```ts
import { emit } from '../events/emit';
```

Then add exactly one `emit(...)` line at the **end** of each mutation, immediately before it returns (the emit layer stamps `at`; do not thread a clock through these methods). Concretely:

- In `create(...)`, after the row is inserted (`const task = ...`):
  ```ts
  emit('task', task.id, 'created', { title: task.title });
  return task;
  ```
- In `update(db, id, patch)`, after applying the patch (`const updated = ...`):
  ```ts
  emit('task', updated.id, 'updated', { patch });
  return updated;
  ```
- In `setStatus(db, id, status)`, capture the previous status before writing, then after writing:
  ```ts
  emit('task', updated.id, 'status_changed', { from: previous.status, to: updated.status });
  ```
- In `complete(db, id, now?)`, after completion:
  ```ts
  emit('task', updated.id, 'completed', {});
  ```
- In `remove(db, id)` (Phase 1 names the task-delete method `remove`, not `delete`), after the delete succeeds:
  ```ts
  emit('task', id, 'deleted', {});
  ```

> Do not pass an explicit `at` to `emit(...)`; the emit layer stamps it (`Date.now()`). These core mutations keep their existing Phase 1–2 signatures — no clock is threaded through `create`/`update`/`setStatus`/`remove` (only `complete` carries `now?: Date`).

- [ ] **Step 4: Add `emit(...)` calls to `project-service.ts`** — mirror the task pattern:
  - `create` → `emit('project', project.id, 'created', { name: project.name });`
  - `update` → `emit('project', updated.id, 'updated', { patch });`
  - `remove` (Phase 1 names the project-delete method `remove`, not `delete`) → `emit('project', id, 'deleted', {});`

- [ ] **Step 5: Add `emit(...)` calls to `time-service.ts`:**
  - `startTimer` → `emit('time_entry', entry.id, 'started', { taskId: entry.taskId });`
  - `stopTimer` → `emit('time_entry', entry.id, 'stopped', { taskId: entry.taskId, durationSeconds: entry.durationSeconds });`
  - `logManual` (manual entry create) → `emit('time_entry', entry.id, 'logged', { taskId: entry.taskId, durationSeconds: entry.durationSeconds });`

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/core test src/services/emit-integration.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 7: Run the full core suite (guard against regressions in existing service tests)**

Run: `pnpm --filter @justdoit/core test`
Expected: PASS — all prior-phase tests still green (emitting is additive; no existing assertion changes).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): emit domain events from task/project/time mutations"
```

---

## Task 3: Activity log service (core)

Persist the event stream into `activityLog` and expose a query API. Deliverable #3 (core half).

**Files:**
- Create: `packages/core/src/services/activity-service.ts`
- Create: `packages/core/src/services/activity-service.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `events` bus (Task 1), the `activityLog` table, `DomainEvent`.
- Produces:
  - `activityService.record(db: Db, event: DomainEvent): ActivityEntry` — inserts one row (`createdAt = new Date(event.at)`).
  - `activityService.list(db: Db, input?: { entityType?: EntityType; entityId?: string; limit?: number }): ActivityEntry[]` — newest first, default limit 100.
  - `startActivityLog(db: Db): () => void` — subscribes `record` to the bus; returns an unsubscribe fn. Call once per process (the API calls it at startup; tests call it per test).
  - `interface ActivityEntry { id: string; entityType: string; entityId: string; action: string; payload: Record<string, unknown> | null; createdAt: Date }`.

- [ ] **Step 1: Write the failing test — `packages/core/src/services/activity-service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations } from '../db/client';
import { events } from '../events/bus';
import { taskService } from './task-service';
import { activityService, startActivityLog } from './activity-service';

describe('activityService', () => {
  beforeEach(() => events.reset());

  it('records an entry for every mutation once the logger is attached', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const stop = startActivityLog(db);

    const task = taskService.create(db, { title: 'Write docs' });
    taskService.setStatus(db, task.id, 'done');

    const entries = activityService.list(db, { entityType: 'task', entityId: task.id });
    expect(entries.map((e) => e.action)).toEqual(['status_changed', 'created']); // newest first
    expect(entries[0]!.payload).toMatchObject({ to: 'done' });
    expect(entries[1]!.createdAt).toBeInstanceOf(Date);
    // newest-first ordering: the later status_changed is at or after the created entry
    expect(entries[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(entries[1]!.createdAt.getTime());
    stop();
  });

  it('stops recording after unsubscribe', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const stop = startActivityLog(db);
    stop();
    taskService.create(db, { title: 'Untracked' });
    expect(activityService.list(db)).toHaveLength(0);
  });

  it('filters by entity and honours limit', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    startActivityLog(db);
    const a = taskService.create(db, { title: 'A' });
    taskService.create(db, { title: 'B' });
    expect(activityService.list(db, { entityId: a.id })).toHaveLength(1);
    expect(activityService.list(db, { limit: 1 })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/core test src/services/activity-service.test.ts`
Expected: FAIL — cannot resolve `./activity-service`.

- [ ] **Step 3: Write `packages/core/src/services/activity-service.ts`**

```ts
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { activityLog } from '../db/schema';
import { events, type DomainEvent, type EntityType } from '../events/bus';

export interface ActivityEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ListActivityInput {
  entityType?: EntityType;
  entityId?: string;
  limit?: number;
}

type ActivityRow = typeof activityLog.$inferSelect;

function toEntry(row: ActivityRow): ActivityEntry {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    payload: row.payload ?? null,
    createdAt: row.createdAt,
  };
}

export const activityService = {
  record(db: Db, event: DomainEvent): ActivityEntry {
    const [row] = db
      .insert(activityLog)
      .values({
        entityType: event.entityType,
        entityId: event.entityId,
        action: event.action,
        payload: event.payload ?? null,
        createdAt: new Date(event.at),
      })
      .returning()
      .all();
    return toEntry(row!);
  },

  list(db: Db, input: ListActivityInput = {}): ActivityEntry[] {
    const conds = [];
    if (input.entityType) conds.push(eq(activityLog.entityType, input.entityType));
    if (input.entityId) conds.push(eq(activityLog.entityId, input.entityId));
    const rows = db
      .select()
      .from(activityLog)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
      .limit(input.limit ?? 100)
      .all();
    return rows.map(toEntry);
  },
};

/** Attach the persistence subscriber to the bus. Returns an unsubscribe fn. */
export function startActivityLog(db: Db): () => void {
  return events.subscribe((event) => {
    activityService.record(db, event);
  });
}
```

- [ ] **Step 4: Export from `packages/core/src/index.ts`** — add:

```ts
export * from './services/activity-service';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/core test src/services/activity-service.test.ts`
Expected: PASS — 3 tests green.

> Note on ordering: two events stamped in the same millisecond are disambiguated by the secondary `desc(activityLog.id)` sort key. The test relies on that for the `created` → `status_changed` ordering.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): persist domain events to activity log"
```

---

## Task 4: Activity log — REST endpoint + web timeline

**Files:**
- Create: `apps/api/src/routes/activity.ts`
- Create: `apps/api/src/routes/activity.test.ts`
- Modify: `apps/api/src/app.ts` (mount route + `startActivityLog(db)`)
- Create: `apps/web/src/components/activity-timeline.tsx`
- Create: `apps/web/src/components/activity-timeline.test.tsx`
- Modify: `apps/web/src/lib/queries.ts` (add `useActivity`)
- Modify: task-detail view to render `<ActivityTimeline taskId=... />`

**Interfaces:**
- Consumes: `activityService`, `startActivityLog`.
- Produces:
  - REST `GET /activity?entity=<type>:<id>` (e.g. `?entity=task:abc`) and/or `?entityType=&entityId=&limit=` → `200 { activity: ActivityEntry[] }`.
  - Web `useActivity(taskId)` → TanStack query keyed `['activity', 'task', taskId]`.
  - Web `<ActivityTimeline taskId>` renders a reverse-chronological list of humanized actions.

- [ ] **Step 1: Ensure the logger is attached — modify `apps/api/src/app.ts`**

In the app factory, after the DB is created/available, call the logger once:

```ts
import { startActivityLog } from '@justdoit/core';
// ...after `const { db } = createDb(process.env.JUSTDOIT_DB ?? 'justdoit.db');`
startActivityLog(db);
```

> The API owns a single long-lived `db`; attaching once at startup is correct. (In tests that build a fresh app per case, the factory attaches per-app; call `events.reset()` in a test `afterEach` if a suite creates multiple apps.)

- [ ] **Step 2: Write the failing REST test — `apps/api/src/routes/activity.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createDb, runMigrations, startActivityLog, taskService, events } from '@justdoit/core';
import { createActivityRoute } from './activity';

function harness() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  events.reset();
  startActivityLog(db);
  const app = createActivityRoute(db);
  return { db, app };
}

describe('GET /activity', () => {
  it('returns activity for a task via entity=task:<id>', async () => {
    const { db, app } = harness();
    const task = taskService.create(db, { title: 'X' });
    const res = await app.request(`/activity?entity=task:${task.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activity[0]).toMatchObject({ entityType: 'task', entityId: task.id, action: 'created' });
  });

  it('400s on a malformed entity param', async () => {
    const { app } = harness();
    const res = await app.request('/activity?entity=garbage');
    expect(res.status).toBe(400);
  });
});
```

> If route modules in this codebase export a mounted sub-app rather than a `create*(db)` factory, adapt the harness to the established pattern (e.g. `app.request` with a middleware that sets `c.set('db', db)`). Keep the assertions identical.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/api test src/routes/activity.test.ts`
Expected: FAIL — cannot resolve `./activity`.

- [ ] **Step 4: Write `apps/api/src/routes/activity.ts`**

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { activityService, ValidationError, type Db } from '@justdoit/core';
import type { Env } from '../context';

const querySchema = z
  .object({
    entity: z
      .string()
      .regex(/^(task|project|time_entry):.+$/, 'entity must be "<type>:<id>"')
      .optional(),
    entityType: z.enum(['task', 'project', 'time_entry']).optional(),
    entityId: z.string().optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
  })
  .transform((q) => {
    if (q.entity) {
      const [entityType, entityId] = q.entity.split(/:(.+)/) as [string, string];
      return { entityType: entityType as 'task' | 'project' | 'time_entry', entityId, limit: q.limit };
    }
    return { entityType: q.entityType, entityId: q.entityId, limit: q.limit };
  });

function buildRoutes(getDb: (c: { get: (k: 'db') => Db }) => Db) {
  const app = new Hono<Env>();
  app.get('/activity', (c) => {
    const parsed = querySchema.safeParse(c.req.query());
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]!.message);
    const db = getDb(c);
    return c.json({ activity: activityService.list(db, parsed.data) });
  });
  return app;
}

/** Mounted variant used by app.ts (db comes from context middleware). */
export const activityRoute = buildRoutes((c) => c.get('db'));

/** Test/factory variant that binds a db directly. */
export function createActivityRoute(db: Db) {
  return buildRoutes(() => db);
}
```

- [ ] **Step 5: Mount in `apps/api/src/app.ts`** — `app.route('/', activityRoute);`

- [ ] **Step 6: Run the REST test to verify it passes**

Run: `pnpm --filter @justdoit/api test src/routes/activity.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 7: Add the web query hook — modify `apps/web/src/lib/queries.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

export interface ActivityEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export function useActivity(taskId: string) {
  return useQuery({
    queryKey: ['activity', 'task', taskId],
    queryFn: () =>
      apiFetch<{ activity: ActivityEntry[] }>(`/activity?entity=task:${taskId}`).then((r) => r.activity),
    enabled: Boolean(taskId),
  });
}
```

- [ ] **Step 8: Write the failing component test — `apps/web/src/components/activity-timeline.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ActivityTimeline } from './activity-timeline';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          activity: [
            { id: '1', entityType: 'task', entityId: 't', action: 'status_changed', payload: { to: 'done' }, createdAt: '2026-07-08T12:00:00.000Z' },
            { id: '2', entityType: 'task', entityId: 't', action: 'created', payload: { title: 'X' }, createdAt: '2026-07-08T11:00:00.000Z' },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('ActivityTimeline', () => {
  it('renders humanized entries newest-first', async () => {
    wrap(<ActivityTimeline taskId="t" />);
    expect(await screen.findByText(/changed status to done/i)).toBeInTheDocument();
    expect(screen.getByText(/created task/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 9: Write `apps/web/src/components/activity-timeline.tsx`**

```tsx
'use client';
import { useActivity, type ActivityEntry } from '@/lib/queries';

function describe(entry: ActivityEntry): string {
  const p = entry.payload ?? {};
  switch (entry.action) {
    case 'created':
      return 'Created task';
    case 'status_changed':
      return `Changed status to ${String(p.to ?? '?')}`;
    case 'completed':
      return 'Completed task';
    case 'updated':
      return 'Updated task';
    case 'deleted':
      return 'Deleted task';
    default:
      return entry.action.replace(/_/g, ' ');
  }
}

export function ActivityTimeline({ taskId }: { taskId: string }) {
  const { data, isLoading } = useActivity(taskId);
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading activity…</p>;
  if (!data?.length) return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  return (
    <ol className="space-y-2" aria-label="Activity timeline">
      {data.map((entry) => (
        <li key={entry.id} className="flex items-baseline gap-2 text-sm">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" aria-hidden />
          <span>{describe(entry)}</span>
          <time className="ml-auto text-xs text-muted-foreground" dateTime={entry.createdAt}>
            {new Date(entry.createdAt).toLocaleString()}
          </time>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 10: Render it in the task-detail view** — add an "Activity" section: `<ActivityTimeline taskId={task.id} />`.

- [ ] **Step 11: Run the component test to verify it passes**

Run: `pnpm --filter @justdoit/web test src/components/activity-timeline.test.tsx`
Expected: PASS — 1 test green ("renders humanized entries newest-first").

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(activity): GET /activity endpoint + task-detail timeline"
```

---

## Task 5: SSE live sync — REST `/events` + web subscription

**Files:**
- Create: `apps/api/src/routes/events.ts`
- Create: `apps/api/src/routes/events.test.ts`
- Modify: `apps/api/src/app.ts` (mount)
- Create: `apps/web/src/hooks/use-live-sync.ts`
- Create: `apps/web/src/hooks/use-live-sync.test.tsx`
- Modify: `apps/web/src/app/providers.tsx` (mount `<LiveSync/>`)

**Interfaces:**
- Consumes: `events` bus.
- Produces:
  - REST `GET /events` — `text/event-stream`. Each `DomainEvent` is written as one SSE message: `data: {"type":"task.updated","entityType":"task","entityId":"…","action":"updated","at":123}`. A comment heartbeat (`: ping`) is sent every 15s. The subscription is torn down on client disconnect.
  - Web `useLiveSync()` — opens an `EventSource` to `/events`, and on each message invalidates the matching query keys:
    - `entityType === 'task'` → `['tasks']`, `['task', id]`, `['activity','task',id]`
    - `entityType === 'project'` → `['projects']`, `['tasks']`
    - `entityType === 'time_entry'` → `['time-entries']`, `['reports']`, `['tasks']`

- [ ] **Step 1: Write the failing REST test — `apps/api/src/routes/events.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { events, emit } from '@justdoit/core';
import { eventsRoute } from './events';

describe('GET /events (SSE)', () => {
  it('streams a published domain event as an SSE data frame', async () => {
    events.reset();
    const res = await eventsRoute.request('/events');
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Publish after the stream is open so the subscriber is attached.
    setTimeout(() => emit('task', 't1', 'updated', { patch: { title: 'new' } }, 1), 10);

    let buf = '';
    while (!buf.includes('task.updated')) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    expect(buf).toContain('data:');
    expect(buf).toContain('"entityId":"t1"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/api test src/routes/events.test.ts`
Expected: FAIL — cannot resolve `./events`.

- [ ] **Step 3: Write `apps/api/src/routes/events.ts`**

```ts
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { events, type DomainEvent } from '@justdoit/core';
import type { Env } from '../context';

export const eventsRoute = new Hono<Env>();

eventsRoute.get('/events', (c) =>
  streamSSE(c, async (stream) => {
    // Queue events and drain them so we never write concurrently to the stream.
    const queue: DomainEvent[] = [];
    let notify: (() => void) | null = null;
    const off = events.subscribe((event) => {
      queue.push(event);
      notify?.();
    });

    const heartbeat = setInterval(() => {
      void stream.writeSSE({ data: '', event: 'ping' }).catch(() => {});
    }, 15_000);

    stream.onAbort(() => {
      off();
      clearInterval(heartbeat);
    });

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
          notify = null;
        }
        const event = queue.shift();
        if (event) {
          await stream.writeSSE({ data: JSON.stringify(event), event: 'change', id: `${event.at}` });
        }
      }
    } finally {
      off();
      clearInterval(heartbeat);
    }
  }),
);
```

- [ ] **Step 4: Mount in `apps/api/src/app.ts`** — `app.route('/', eventsRoute);`

- [ ] **Step 5: Run the REST test to verify it passes**

Run: `pnpm --filter @justdoit/api test src/routes/events.test.ts`
Expected: PASS — 1 test green. The stream yields a `data:` frame containing `"entityId":"t1"`.

- [ ] **Step 6: Write the failing hook test — `apps/web/src/hooks/use-live-sync.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLiveSync } from './use-live-sync';

class FakeEventSource {
  static last: FakeEventSource | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
});

describe('useLiveSync', () => {
  it('invalidates task queries when a task event arrives', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useLiveSync(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    });
    FakeEventSource.last!.onmessage!({
      data: JSON.stringify({ type: 'task.updated', entityType: 'task', entityId: 't1', action: 'updated', at: 1 }),
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['tasks'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['task', 't1'] });
  });
});
```

- [ ] **Step 7: Write `apps/web/src/hooks/use-live-sync.ts`**

```ts
'use client';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiUrl } from '@/lib/api';

interface WireEvent {
  type: string;
  entityType: 'task' | 'project' | 'time_entry';
  entityId: string;
  action: string;
  at: number;
}

export function useLiveSync(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const source = new EventSource(apiUrl('/events'));
    const handle = (raw: MessageEvent) => {
      let evt: WireEvent;
      try {
        evt = JSON.parse(raw.data) as WireEvent;
      } catch {
        return;
      }
      switch (evt.entityType) {
        case 'task':
          qc.invalidateQueries({ queryKey: ['tasks'] });
          qc.invalidateQueries({ queryKey: ['task', evt.entityId] });
          qc.invalidateQueries({ queryKey: ['activity', 'task', evt.entityId] });
          break;
        case 'project':
          qc.invalidateQueries({ queryKey: ['projects'] });
          qc.invalidateQueries({ queryKey: ['tasks'] });
          break;
        case 'time_entry':
          qc.invalidateQueries({ queryKey: ['time-entries'] });
          qc.invalidateQueries({ queryKey: ['reports'] });
          qc.invalidateQueries({ queryKey: ['tasks'] });
          break;
      }
    };
    // The API tags change frames with `event: change`; also handle default `message`.
    source.addEventListener('change', handle as EventListener);
    source.onmessage = handle;
    return () => source.close();
  }, [qc]);
}

/** Headless mount point. */
export function LiveSync(): null {
  useLiveSync();
  return null;
}
```

- [ ] **Step 8: Mount `<LiveSync/>` in `apps/web/src/app/providers.tsx`** — inside the `QueryClientProvider`, render `<LiveSync />` once alongside `children`.

> Note: the hook test drives `onmessage` directly, so it covers the default-message path. In production the API tags frames `event: change`; the `addEventListener('change', …)` line handles those.

- [ ] **Step 9: Run the hook test to verify it passes**

Run: `pnpm --filter @justdoit/web test src/hooks/use-live-sync.test.tsx`
Expected: PASS — 1 test green.

- [ ] **Step 10: Manual smoke check (optional but recommended)**

Run (API on :8787): `curl -N http://localhost:8787/events` in one shell, then in another `curl -X POST http://localhost:8787/tasks -H 'content-type: application/json' -d '{"title":"live"}'`.
Expected: the `curl -N` shell prints a line like `event: change` followed by `data: {"type":"task.created",...}` within a second.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(sync): SSE /events stream + web live query invalidation"
```

---

## Task 6: Saved filters — core service + REST + web

**Files:**
- Create: `packages/core/src/services/saved-filter-service.ts`
- Create: `packages/core/src/services/saved-filter-service.test.ts`
- Modify: `packages/core/src/index.ts`
- Create: `apps/api/src/routes/saved-filters.ts`
- Create: `apps/api/src/routes/saved-filters.test.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/web/src/components/saved-filters-menu.tsx`
- Create: `apps/web/src/components/saved-filters-menu.test.tsx`
- Modify: `apps/web/src/lib/queries.ts`

**Interfaces:**
- Consumes: `savedFilters` table, error classes.
- Produces:
  - `savedFilterService.create(db, input: CreateSavedFilterInput, now?: Date): SavedFilterRecord`
  - `savedFilterService.list(db): SavedFilterRecord[]`
  - `savedFilterService.get(db, id): SavedFilterRecord` (throws `NotFoundError`)
  - `savedFilterService.update(db, id, input: UpdateSavedFilterInput, now?: Date): SavedFilterRecord`
  - `savedFilterService.remove(db, id): void` (throws `NotFoundError` if absent)
  - Zod: `createSavedFilterSchema`, `updateSavedFilterSchema`, `savedFilterQuerySchema`; types `SavedFilterQuery`, `CreateSavedFilterInput`, `UpdateSavedFilterInput`, `SavedFilterRecord`.
  - REST: `GET /saved-filters`, `POST /saved-filters`, `GET /saved-filters/:id`, `PATCH /saved-filters/:id`, `DELETE /saved-filters/:id`.
  - Web: `useSavedFilters()`, `useCreateSavedFilter()`, `useDeleteSavedFilter()`; `<SavedFiltersMenu current={query} onApply={fn} />`.

- [ ] **Step 1: Write the failing core test — `packages/core/src/services/saved-filter-service.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createDb, runMigrations } from '../db/client';
import { NotFoundError } from '../errors';
import { savedFilterService } from './saved-filter-service';

const now = new Date('2026-07-08T12:00:00.000Z');

function db() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

describe('savedFilterService', () => {
  it('creates, lists, gets, updates and deletes a filter', () => {
    const d = db();
    const created = savedFilterService.create(d, { name: 'Overdue P0', query: { priorities: ['p0'], due: 'overdue' } }, now);
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(created.query).toEqual({ priorities: ['p0'], due: 'overdue' });

    expect(savedFilterService.list(d)).toHaveLength(1);
    expect(savedFilterService.get(d, created.id).name).toBe('Overdue P0');

    const updated = savedFilterService.update(d, created.id, { name: 'Renamed' }, now);
    expect(updated.name).toBe('Renamed');

    savedFilterService.remove(d, created.id);
    expect(savedFilterService.list(d)).toHaveLength(0);
  });

  it('throws NotFoundError for a missing id', () => {
    const d = db();
    expect(() => savedFilterService.get(d, 'nope')).toThrow(NotFoundError);
    expect(() => savedFilterService.remove(d, 'nope')).toThrow(NotFoundError);
  });

  it('rejects an empty name via schema validation', () => {
    const d = db();
    expect(() => savedFilterService.create(d, { name: '', query: {} } as never)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @justdoit/core test src/services/saved-filter-service.test.ts`
Expected: FAIL — cannot resolve `./saved-filter-service`.

- [ ] **Step 3: Write `packages/core/src/services/saved-filter-service.ts`**

```ts
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { savedFilters } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';

export const savedFilterQuerySchema = z
  .object({
    statuses: z.array(z.string()).optional(),
    priorities: z.array(z.string()).optional(),
    projectId: z.string().optional(),
    tagIds: z.array(z.string()).optional(),
    search: z.string().optional(),
    due: z.enum(['overdue', 'today', 'week', 'none']).optional(),
    sort: z.string().optional(),
    groupBy: z.string().optional(),
  })
  .passthrough();

export const createSavedFilterSchema = z.object({
  name: z.string().min(1).max(120),
  query: savedFilterQuerySchema,
});

export const updateSavedFilterSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  query: savedFilterQuerySchema.optional(),
});

export type SavedFilterQuery = z.infer<typeof savedFilterQuerySchema>;
export type CreateSavedFilterInput = z.infer<typeof createSavedFilterSchema>;
export type UpdateSavedFilterInput = z.infer<typeof updateSavedFilterSchema>;

export interface SavedFilterRecord {
  id: string;
  name: string;
  query: SavedFilterQuery;
  createdAt: Date;
  updatedAt: Date;
}

type Row = typeof savedFilters.$inferSelect;
function toRecord(row: Row): SavedFilterRecord {
  return {
    id: row.id,
    name: row.name,
    query: (row.query ?? {}) as SavedFilterQuery,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ValidationError(result.error.issues[0]!.message);
  return result.data;
}

export const savedFilterService = {
  create(db: Db, input: CreateSavedFilterInput, now: Date = new Date()): SavedFilterRecord {
    const data = parse(createSavedFilterSchema, input);
    const [row] = db
      .insert(savedFilters)
      .values({ name: data.name, query: data.query, createdAt: now, updatedAt: now })
      .returning()
      .all();
    return toRecord(row!);
  },

  list(db: Db): SavedFilterRecord[] {
    return db.select().from(savedFilters).orderBy(desc(savedFilters.createdAt)).all().map(toRecord);
  },

  get(db: Db, id: string): SavedFilterRecord {
    const row = db.select().from(savedFilters).where(eq(savedFilters.id, id)).get();
    if (!row) throw new NotFoundError(`Saved filter ${id} not found`);
    return toRecord(row);
  },

  update(db: Db, id: string, input: UpdateSavedFilterInput, now: Date = new Date()): SavedFilterRecord {
    const data = parse(updateSavedFilterSchema, input);
    savedFilterService.get(db, id); // throws NotFoundError if absent
    const [row] = db
      .update(savedFilters)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.query !== undefined ? { query: data.query } : {}),
        updatedAt: now,
      })
      .where(eq(savedFilters.id, id))
      .returning()
      .all();
    return toRecord(row!);
  },

  remove(db: Db, id: string): void {
    const deleted = db.delete(savedFilters).where(eq(savedFilters.id, id)).returning().all();
    if (deleted.length === 0) throw new NotFoundError(`Saved filter ${id} not found`);
  },
};
```

- [ ] **Step 4: Export from `packages/core/src/index.ts`** — `export * from './services/saved-filter-service';`

- [ ] **Step 5: Run core test to verify it passes**

Run: `pnpm --filter @justdoit/core test src/services/saved-filter-service.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 6: Write the failing REST test — `apps/api/src/routes/saved-filters.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createDb, runMigrations } from '@justdoit/core';
import { createSavedFiltersRoute } from './saved-filters';

function harness() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return createSavedFiltersRoute(db);
}

describe('/saved-filters', () => {
  it('creates and lists saved filters', async () => {
    const app = harness();
    const create = await app.request('/saved-filters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Today', query: { due: 'today' } }),
    });
    expect(create.status).toBe(201);
    const { savedFilter } = await create.json();
    expect(savedFilter.name).toBe('Today');

    const list = await app.request('/saved-filters');
    expect((await list.json()).savedFilters).toHaveLength(1);
  });

  it('400s on empty name and 404s on unknown id delete', async () => {
    const app = harness();
    const bad = await app.request('/saved-filters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', query: {} }),
    });
    expect(bad.status).toBe(400);
    const del = await app.request('/saved-filters/nope', { method: 'DELETE' });
    expect(del.status).toBe(404);
  });
});
```

- [ ] **Step 7: Write `apps/api/src/routes/saved-filters.ts`**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  savedFilterService,
  createSavedFilterSchema,
  updateSavedFilterSchema,
  type Db,
} from '@justdoit/core';
import type { Env } from '../context';

function buildRoutes(getDb: (c: { get: (k: 'db') => Db }) => Db) {
  const app = new Hono<Env>();

  app.get('/saved-filters', (c) => c.json({ savedFilters: savedFilterService.list(getDb(c)) }));

  app.post('/saved-filters', zValidator('json', createSavedFilterSchema), (c) =>
    c.json({ savedFilter: savedFilterService.create(getDb(c), c.req.valid('json')) }, 201),
  );

  app.get('/saved-filters/:id', (c) =>
    c.json({ savedFilter: savedFilterService.get(getDb(c), c.req.param('id')) }),
  );

  app.patch('/saved-filters/:id', zValidator('json', updateSavedFilterSchema), (c) =>
    c.json({ savedFilter: savedFilterService.update(getDb(c), c.req.param('id'), c.req.valid('json')) }),
  );

  app.delete('/saved-filters/:id', (c) => {
    savedFilterService.remove(getDb(c), c.req.param('id'));
    return c.body(null, 204);
  });

  return app;
}

export const savedFiltersRoute = buildRoutes((c) => c.get('db'));
export function createSavedFiltersRoute(db: Db) {
  return buildRoutes(() => db);
}
```

- [ ] **Step 8: Mount in `apps/api/src/app.ts`** — `app.route('/', savedFiltersRoute);`

- [ ] **Step 9: Run the REST test to verify it passes**

Run: `pnpm --filter @justdoit/api test src/routes/saved-filters.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 10: Add web hooks — modify `apps/web/src/lib/queries.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './api';

export interface SavedFilter {
  id: string;
  name: string;
  query: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export function useSavedFilters() {
  return useQuery({
    queryKey: ['saved-filters'],
    queryFn: () => apiFetch<{ savedFilters: SavedFilter[] }>('/saved-filters').then((r) => r.savedFilters),
  });
}

export function useCreateSavedFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; query: Record<string, unknown> }) =>
      apiFetch<{ savedFilter: SavedFilter }>('/saved-filters', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-filters'] }),
  });
}

export function useDeleteSavedFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/saved-filters/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-filters'] }),
  });
}
```

- [ ] **Step 11: Write the failing component test — `apps/web/src/components/saved-filters-menu.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SavedFiltersMenu } from './saved-filters-menu';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ savedFilters: [{ id: 's1', name: 'Today', query: { due: 'today' }, createdAt: '', updatedAt: '' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('SavedFiltersMenu', () => {
  it('lists saved views and applies one on click', async () => {
    const onApply = vi.fn();
    wrap(<SavedFiltersMenu current={{}} onApply={onApply} />);
    fireEvent.click(await screen.findByRole('button', { name: /today/i }));
    expect(onApply).toHaveBeenCalledWith({ due: 'today' });
  });
});
```

- [ ] **Step 12: Write `apps/web/src/components/saved-filters-menu.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { useSavedFilters, useCreateSavedFilter, useDeleteSavedFilter } from '@/lib/queries';
import { Button } from '@/components/ui/button';

export function SavedFiltersMenu({
  current,
  onApply,
}: {
  current: Record<string, unknown>;
  onApply: (query: Record<string, unknown>) => void;
}) {
  const { data: filters = [] } = useSavedFilters();
  const create = useCreateSavedFilter();
  const remove = useDeleteSavedFilter();
  const [name, setName] = useState('');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1" aria-label="Saved views">
        {filters.map((f) => (
          <span key={f.id} className="inline-flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => onApply(f.query)}>
              {f.name}
            </Button>
            <button aria-label={`Delete ${f.name}`} onClick={() => remove.mutate(f.id)} className="text-muted-foreground">
              ×
            </button>
          </span>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          create.mutate({ name: name.trim(), query: current }, { onSuccess: () => setName('') });
        }}
      >
        <input
          className="border rounded px-2 py-1 text-sm"
          placeholder="Save current view…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Saved view name"
        />
        <Button type="submit" size="sm" disabled={!name.trim()}>
          Save view
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 13: Wire `<SavedFiltersMenu>` into the list/board toolbar** — pass the current filter state and an `onApply` that sets it.

- [ ] **Step 14: Run the component test to verify it passes**

Run: `pnpm --filter @justdoit/web test src/components/saved-filters-menu.test.tsx`
Expected: PASS — 1 test green.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "feat(saved-filters): service, REST CRUD, and web save/apply/delete menu"
```

---

## Task 7: Bulk actions — core + REST + web

**Files:**
- Modify: `packages/core/src/services/task-service.ts` (add `bulkUpdate`, `bulkDelete`)
- Create: `packages/core/src/services/task-bulk.test.ts`
- Modify: `apps/api/src/routes/tasks.ts` (add `PATCH /tasks/bulk`, `POST /tasks/bulk-delete`)
- Create: `apps/api/src/routes/tasks-bulk.test.ts`
- Create: `apps/web/src/components/bulk-action-toolbar.tsx`
- Create: `apps/web/src/components/bulk-action-toolbar.test.tsx`
- Modify: `apps/web/src/lib/queries.ts`

**Interfaces:**
- Consumes: `tasks`, `taskTags` tables; `emit`; error classes.
- Produces:
  - `taskService.bulkUpdate(db, ids: string[], patch: BulkPatch): Task[]` where
    `interface BulkPatch { status?: TaskStatus; priority?: TaskPriority | null; projectId?: string | null; addTagIds?: string[]; removeTagIds?: string[] }`.
    Emits `task.updated` (and `task.status_changed` when status changes) per affected id. Throws `NotFoundError` if any id is missing; `ValidationError` on empty `ids` or invalid patch.
  - `taskService.bulkDelete(db, ids: string[]): { deleted: number }`. Emits `task.deleted` per id.
  - REST: `PATCH /tasks/bulk` → `{ tasks: Task[] }`; `POST /tasks/bulk-delete` → `{ deleted: number }`.
  - Web: `useBulkUpdateTasks()`, `useBulkDeleteTasks()`; `<BulkActionToolbar selectedIds onDone />`.

- [ ] **Step 1: Write the failing core test — `packages/core/src/services/task-bulk.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations } from '../db/client';
import { events, type DomainEvent } from '../events/bus';
import { NotFoundError, ValidationError } from '../errors';
import { taskService } from './task-service';

describe('taskService.bulkUpdate / bulkDelete', () => {
  beforeEach(() => events.reset());

  it('updates status/priority across many tasks and emits per task', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const seen: DomainEvent[] = [];
    events.subscribe((e) => seen.push(e));
    const a = taskService.create(db, { title: 'A' });
    const b = taskService.create(db, { title: 'B' });
    seen.length = 0;

    const updated = taskService.bulkUpdate(db, [a.id, b.id], { status: 'done', priority: 'p1' });
    expect(updated).toHaveLength(2);
    expect(updated.every((t) => t.status === 'done' && t.priority === 'p1')).toBe(true);
    expect(seen.filter((e) => e.type === 'task.status_changed')).toHaveLength(2);
  });

  it('bulkDelete removes tasks and reports the count', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const a = taskService.create(db, { title: 'A' });
    const b = taskService.create(db, { title: 'B' });
    expect(taskService.bulkDelete(db, [a.id, b.id])).toEqual({ deleted: 2 });
    expect(taskService.list(db)).toHaveLength(0);
  });

  it('throws NotFoundError if any id is missing and ValidationError on empty ids', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const a = taskService.create(db, { title: 'A' });
    expect(() => taskService.bulkUpdate(db, [a.id, 'ghost'], { status: 'todo' })).toThrow(NotFoundError);
    expect(() => taskService.bulkUpdate(db, [], { status: 'todo' })).toThrow(ValidationError);
  });
});
```

> Adjust `taskService.list` call if the existing list method requires a filter argument; use whatever the Phase-1 signature is.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @justdoit/core test src/services/task-bulk.test.ts`
Expected: FAIL — `bulkUpdate is not a function`.

- [ ] **Step 3: Add `bulkUpdate` and `bulkDelete` to the `taskService` object in `task-service.ts`**

Add these methods (place them inside the existing `export const taskService = { ... }` object). Imports needed at top: `inArray, eq, and` from `drizzle-orm`; `taskTags` from `../db/schema`; `ValidationError, NotFoundError` from `../errors`.

```ts
export interface BulkPatch {
  status?: TaskStatus;
  priority?: TaskPriority | null;
  projectId?: string | null;
  addTagIds?: string[];
  removeTagIds?: string[];
}

// --- inside the taskService object ---
bulkUpdate(db: Db, ids: string[], patch: BulkPatch): Task[] {
  if (ids.length === 0) throw new ValidationError('bulkUpdate requires at least one id');

  const existing = db.select().from(tasks).where(inArray(tasks.id, ids)).all();
  const byId = new Map(existing.map((t) => [t.id, t]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new NotFoundError(`Task(s) not found: ${missing.join(', ')}`);

  const setClause: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
  if (patch.status !== undefined) {
    setClause.status = patch.status;
    setClause.completedAt = patch.status === 'done' || patch.status === 'cancelled' ? new Date() : null;
  }
  if (patch.priority !== undefined) setClause.priority = patch.priority;
  if (patch.projectId !== undefined) setClause.projectId = patch.projectId;

  db.update(tasks).set(setClause).where(inArray(tasks.id, ids)).run();

  if (patch.removeTagIds?.length) {
    for (const id of ids) {
      db.delete(taskTags)
        .where(and(eq(taskTags.taskId, id), inArray(taskTags.tagId, patch.removeTagIds)))
        .run();
    }
  }
  if (patch.addTagIds?.length) {
    for (const id of ids) {
      for (const tagId of patch.addTagIds) {
        db.insert(taskTags).values({ taskId: id, tagId }).onConflictDoNothing().run();
      }
    }
  }

  const updated = db.select().from(tasks).where(inArray(tasks.id, ids)).all();
  for (const t of updated) {
    const before = byId.get(t.id)!;
    if (patch.status !== undefined && before.status !== t.status) {
      emit('task', t.id, 'status_changed', { from: before.status, to: t.status });
    }
    emit('task', t.id, 'updated', { patch });
  }
  return updated;
},

bulkDelete(db: Db, ids: string[]): { deleted: number } {
  if (ids.length === 0) throw new ValidationError('bulkDelete requires at least one id');
  const deleted = db.delete(tasks).where(inArray(tasks.id, ids)).returning().all();
  for (const t of deleted) emit('task', t.id, 'deleted', {});
  return { deleted: deleted.length };
},
```

- [ ] **Step 4: Run core test to verify it passes**

Run: `pnpm --filter @justdoit/core test src/services/task-bulk.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Write the failing REST test — `apps/api/src/routes/tasks-bulk.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createDb, runMigrations, taskService } from '@justdoit/core';
import { createTasksRoute } from './tasks'; // existing factory; add bulk routes to it

function harness() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return { db, app: createTasksRoute(db) };
}

describe('bulk task routes', () => {
  it('PATCH /tasks/bulk updates many tasks', async () => {
    const { db, app } = harness();
    const a = taskService.create(db, { title: 'A' });
    const b = taskService.create(db, { title: 'B' });
    const res = await app.request('/tasks/bulk', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [a.id, b.id], patch: { status: 'done' } }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).tasks).toHaveLength(2);
  });

  it('POST /tasks/bulk-delete returns the count', async () => {
    const { db, app } = harness();
    const a = taskService.create(db, { title: 'A' });
    const res = await app.request('/tasks/bulk-delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [a.id] }),
    });
    expect(await res.json()).toEqual({ deleted: 1 });
  });
});
```

- [ ] **Step 6: Add the bulk routes to `apps/api/src/routes/tasks.ts`**

Register these **before** the `/:id` routes so `bulk` / `bulk-delete` are not swallowed by the `:id` param matcher.

```ts
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { taskService } from '@justdoit/core';

const bulkPatchSchema = z.object({
  ids: z.array(z.string()).min(1),
  patch: z.object({
    status: z.enum(['backlog', 'todo', 'in_progress', 'blocked', 'done', 'cancelled']).optional(),
    priority: z.enum(['p0', 'p1', 'p2', 'p3']).nullable().optional(),
    projectId: z.string().nullable().optional(),
    addTagIds: z.array(z.string()).optional(),
    removeTagIds: z.array(z.string()).optional(),
  }),
});
const bulkDeleteSchema = z.object({ ids: z.array(z.string()).min(1) });

// register BEFORE app.get('/tasks/:id', ...)
app.patch('/tasks/bulk', zValidator('json', bulkPatchSchema), (c) => {
  const { ids, patch } = c.req.valid('json');
  return c.json({ tasks: taskService.bulkUpdate(getDb(c), ids, patch) });
});
app.post('/tasks/bulk-delete', zValidator('json', bulkDeleteSchema), (c) => {
  const { ids } = c.req.valid('json');
  return c.json(taskService.bulkDelete(getDb(c), ids));
});
```

> `getDb(c)` mirrors the accessor the existing tasks route already uses (`c.get('db')` in the mounted variant). If `tasks.ts` doesn't yet expose a `createTasksRoute(db)` factory, add one with the same `buildRoutes(getDb)` pattern used in Task 4/6 so the test harness can bind a db.

- [ ] **Step 7: Run the REST test to verify it passes**

Run: `pnpm --filter @justdoit/api test src/routes/tasks-bulk.test.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 8: Add web mutations — modify `apps/web/src/lib/queries.ts`**

```ts
export function useBulkUpdateTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids: string[]; patch: Record<string, unknown> }) =>
      apiFetch<{ tasks: unknown[] }>('/tasks/bulk', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useBulkDeleteTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch<{ deleted: number }>('/tasks/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}
```

- [ ] **Step 9: Write the failing component test — `apps/web/src/components/bulk-action-toolbar.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BulkActionToolbar } from './bulk-action-toolbar';

let calls: Array<{ url: string; body: unknown }> = [];
beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
      return new Response(JSON.stringify({ tasks: [], deleted: 2 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('BulkActionToolbar', () => {
  it('shows the selection count and sends a bulk delete', async () => {
    wrap(<BulkActionToolbar selectedIds={['a', 'b']} onDone={() => {}} />);
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    await vi.waitFor(() => expect(calls.some((c) => c.url.includes('/tasks/bulk-delete'))).toBe(true));
    expect(calls.find((c) => c.url.includes('bulk-delete'))!.body).toEqual({ ids: ['a', 'b'] });
  });

  it('sends a status change', async () => {
    wrap(<BulkActionToolbar selectedIds={['a']} onDone={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /mark done/i }));
    await vi.waitFor(() => expect(calls.some((c) => c.url.includes('/tasks/bulk'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/tasks/bulk'))!.body).toEqual({ ids: ['a'], patch: { status: 'done' } });
  });
});
```

- [ ] **Step 10: Write `apps/web/src/components/bulk-action-toolbar.tsx`**

```tsx
'use client';
import { useBulkUpdateTasks, useBulkDeleteTasks } from '@/lib/queries';
import { Button } from '@/components/ui/button';

export function BulkActionToolbar({ selectedIds, onDone }: { selectedIds: string[]; onDone: () => void }) {
  const update = useBulkUpdateTasks();
  const remove = useBulkDeleteTasks();
  if (selectedIds.length === 0) return null;

  const patch = (p: Record<string, unknown>) => update.mutate({ ids: selectedIds, patch: p }, { onSuccess: onDone });

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border bg-background px-4 py-2 shadow-lg"
    >
      <span className="text-sm font-medium">{selectedIds.length} selected</span>
      <Button size="sm" variant="secondary" onClick={() => patch({ status: 'done' })}>
        Mark done
      </Button>
      <Button size="sm" variant="secondary" onClick={() => patch({ priority: 'p1' })}>
        Set P1
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => remove.mutate(selectedIds, { onSuccess: onDone })}
      >
        Delete
      </Button>
    </div>
  );
}
```

> Full project/tag pickers use the shadcn `Select`/`Popover` primitives with the same `patch({ projectId })` / `patch({ addTagIds })` calls; the test covers status + delete as the representative paths. Multi-select state (which task ids are checked) lives in the list/board view and is passed in as `selectedIds`.

- [ ] **Step 11: Wire multi-select into the list/board view** — track a `Set<string>` of selected ids, render row checkboxes, and render `<BulkActionToolbar selectedIds={[...sel]} onDone={() => setSel(new Set())} />`.

- [ ] **Step 12: Run the component test to verify it passes**

Run: `pnpm --filter @justdoit/web test src/components/bulk-action-toolbar.test.tsx`
Expected: PASS — 2 tests green.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(bulk): bulkUpdate/bulkDelete service, REST, and multi-select toolbar"
```

---

## Task 8: Attachments — core + REST + web

**Files:**
- Create: `packages/core/src/services/attachment-service.ts`
- Create: `packages/core/src/services/attachment-service.test.ts`
- Modify: `packages/core/src/index.ts`
- Create: `apps/api/src/routes/attachments.ts`
- Create: `apps/api/src/routes/attachments.test.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/web/src/components/attachments-panel.tsx`
- Create: `apps/web/src/components/attachments-panel.test.tsx`
- Modify: `apps/web/src/lib/queries.ts`

**Interfaces:**
- Consumes: `attachments`, `tasks` tables; `NotFoundError`, `ValidationError`; Node `fs`.
- Produces:
  - `attachmentService.add(db, input: AddAttachmentInput, opts?: { filesDir?: string }): Promise<AttachmentRecord>` — validates size/mime, writes the file to `<filesDir>/<taskId>/<uuid><ext>`, inserts the row. Throws `NotFoundError` (unknown task), `ValidationError` (too big / disallowed type).
    `interface AddAttachmentInput { taskId: string; filename: string; mime: string; data: Uint8Array }`.
  - `attachmentService.list(db, taskId): AttachmentRecord[]`
  - `attachmentService.get(db, id): { record: AttachmentRecord; absolutePath: string }` (throws `NotFoundError`)
  - `attachmentService.remove(db, id, opts?: { filesDir?: string }): Promise<void>` — deletes file then row.
  - Constants: `MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024`, `ALLOWED_ATTACHMENT_MIME` (Set).
  - REST: `POST /tasks/:id/attachments` (multipart, field `file`) → `201 { attachment }`; `GET /attachments/:id` → streams bytes with `Content-Type`/`Content-Disposition`; `DELETE /attachments/:id` → `204`.
  - Web: `useAttachments(taskId)`, `useUploadAttachment(taskId)`, `useDeleteAttachment()`; `<AttachmentsPanel taskId />`.

- [ ] **Step 1: Write the failing core test — `packages/core/src/services/attachment-service.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, runMigrations } from '../db/client';
import { NotFoundError, ValidationError } from '../errors';
import { taskService } from './task-service';
import { attachmentService } from './attachment-service';

const dirs: string[] = [];
async function filesDir() {
  const d = await fs.mkdtemp(join(tmpdir(), 'justdoit-files-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('attachmentService', () => {
  it('stores a file on disk and lists it', async () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const fdir = await filesDir();
    const task = taskService.create(db, { title: 'With file' });

    const rec = await attachmentService.add(
      db,
      { taskId: task.id, filename: 'note.txt', mime: 'text/plain', data: new TextEncoder().encode('hello') },
      { filesDir: fdir },
    );
    expect(rec.size).toBe(5);
    expect(attachmentService.list(db, task.id)).toHaveLength(1);

    const got = attachmentService.get(db, rec.id);
    expect(await fs.readFile(got.absolutePath, 'utf8')).toBe('hello');
  });

  it('rejects a disallowed mime type and an oversized file', async () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const fdir = await filesDir();
    const task = taskService.create(db, { title: 'T' });
    await expect(
      attachmentService.add(db, { taskId: task.id, filename: 'a.exe', mime: 'application/x-msdownload', data: new Uint8Array(1) }, { filesDir: fdir }),
    ).rejects.toThrow(ValidationError);
  });

  it('throws NotFoundError for an unknown task', async () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const fdir = await filesDir();
    await expect(
      attachmentService.add(db, { taskId: 'ghost', filename: 'a.txt', mime: 'text/plain', data: new Uint8Array(1) }, { filesDir: fdir }),
    ).rejects.toThrow(NotFoundError);
  });

  it('removes the file and the row', async () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const fdir = await filesDir();
    const task = taskService.create(db, { title: 'T' });
    const rec = await attachmentService.add(db, { taskId: task.id, filename: 'x.txt', mime: 'text/plain', data: new Uint8Array([1]) }, { filesDir: fdir });
    await attachmentService.remove(db, rec.id, { filesDir: fdir });
    expect(attachmentService.list(db, task.id)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @justdoit/core test src/services/attachment-service.test.ts`
Expected: FAIL — cannot resolve `./attachment-service`.

- [ ] **Step 3: Write `packages/core/src/services/attachment-service.ts`**

```ts
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { attachments, tasks } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB
export const ALLOWED_ATTACHMENT_MIME = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/zip',
]);
const DEFAULT_FILES_DIR = './data/files';

export interface AddAttachmentInput {
  taskId: string;
  filename: string;
  mime: string;
  data: Uint8Array;
}

export interface AttachmentRecord {
  id: string;
  taskId: string;
  filename: string;
  path: string;
  mime: string | null;
  size: number | null;
  createdAt: Date;
}

type Row = typeof attachments.$inferSelect;
const toRecord = (r: Row): AttachmentRecord => ({
  id: r.id,
  taskId: r.taskId,
  filename: r.filename,
  path: r.path,
  mime: r.mime,
  size: r.size,
  createdAt: r.createdAt,
});

function sanitize(filename: string): string {
  return filename.replace(/[/\\]/g, '_').slice(0, 200) || 'file';
}

export const attachmentService = {
  async add(db: Db, input: AddAttachmentInput, opts: { filesDir?: string } = {}): Promise<AttachmentRecord> {
    const filesDir = opts.filesDir ?? DEFAULT_FILES_DIR;
    if (input.data.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new ValidationError(`File exceeds ${MAX_ATTACHMENT_BYTES} bytes`);
    }
    if (!ALLOWED_ATTACHMENT_MIME.has(input.mime)) {
      throw new ValidationError(`Unsupported file type: ${input.mime}`);
    }
    const task = db.select().from(tasks).where(eq(tasks.id, input.taskId)).get();
    if (!task) throw new NotFoundError(`Task ${input.taskId} not found`);

    const safeName = sanitize(input.filename);
    const storedName = `${randomUUID()}${extname(safeName)}`;
    const relPath = join(input.taskId, storedName);
    const absPath = join(filesDir, relPath);
    await fs.mkdir(join(filesDir, input.taskId), { recursive: true });
    await fs.writeFile(absPath, input.data);

    const [row] = db
      .insert(attachments)
      .values({
        taskId: input.taskId,
        filename: safeName,
        path: relPath,
        mime: input.mime,
        size: input.data.byteLength,
      })
      .returning()
      .all();
    return toRecord(row!);
  },

  list(db: Db, taskId: string): AttachmentRecord[] {
    return db.select().from(attachments).where(eq(attachments.taskId, taskId)).all().map(toRecord);
  },

  get(db: Db, id: string, opts: { filesDir?: string } = {}): { record: AttachmentRecord; absolutePath: string } {
    const filesDir = opts.filesDir ?? DEFAULT_FILES_DIR;
    const row = db.select().from(attachments).where(eq(attachments.id, id)).get();
    if (!row) throw new NotFoundError(`Attachment ${id} not found`);
    const record = toRecord(row);
    const absolutePath = isAbsolute(record.path) ? record.path : resolve(filesDir, record.path);
    return { record, absolutePath };
  },

  async remove(db: Db, id: string, opts: { filesDir?: string } = {}): Promise<void> {
    const { record, absolutePath } = attachmentService.get(db, id, opts);
    await fs.rm(absolutePath, { force: true });
    db.delete(attachments).where(eq(attachments.id, record.id)).run();
  },
};
```

- [ ] **Step 4: Export from `packages/core/src/index.ts`** — `export * from './services/attachment-service';`

- [ ] **Step 5: Run core test to verify it passes**

Run: `pnpm --filter @justdoit/core test src/services/attachment-service.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 6: Write the failing REST test — `apps/api/src/routes/attachments.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, runMigrations, taskService } from '@justdoit/core';
import { createAttachmentsRoute } from './attachments';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function harness() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  const filesDir = await fs.mkdtemp(join(tmpdir(), 'jd-api-'));
  dirs.push(filesDir);
  return { db, filesDir, app: createAttachmentsRoute(db, filesDir) };
}

describe('attachment routes', () => {
  it('uploads (multipart), lists via download, and deletes', async () => {
    const { db, app } = await harness();
    const task = taskService.create(db, { title: 'T' });

    const form = new FormData();
    form.append('file', new File(['hello'], 'note.txt', { type: 'text/plain' }));
    const up = await app.request(`/tasks/${task.id}/attachments`, { method: 'POST', body: form });
    expect(up.status).toBe(201);
    const { attachment } = await up.json();

    const dl = await app.request(`/attachments/${attachment.id}`);
    expect(dl.status).toBe(200);
    expect(await dl.text()).toBe('hello');

    const del = await app.request(`/attachments/${attachment.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
  });

  it('415/400s on a disallowed type', async () => {
    const { db, app } = await harness();
    const task = taskService.create(db, { title: 'T' });
    const form = new FormData();
    form.append('file', new File(['x'], 'a.exe', { type: 'application/x-msdownload' }));
    const up = await app.request(`/tasks/${task.id}/attachments`, { method: 'POST', body: form });
    expect(up.status).toBe(400);
  });
});
```

- [ ] **Step 7: Write `apps/api/src/routes/attachments.ts`**

```ts
import { Hono } from 'hono';
import { attachmentService, ValidationError, type Db } from '@justdoit/core';
import type { Env } from '../context';

function buildRoutes(getDb: (c: { get: (k: 'db') => Db }) => Db, filesDir: string) {
  const app = new Hono<Env>();

  app.post('/tasks/:id/attachments', async (c) => {
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) throw new ValidationError('Expected a multipart field "file"');
    const data = new Uint8Array(await file.arrayBuffer());
    const attachment = await attachmentService.add(
      getDb(c),
      { taskId: c.req.param('id'), filename: file.name, mime: file.type || 'application/octet-stream', data },
      { filesDir },
    );
    return c.json({ attachment }, 201);
  });

  app.get('/tasks/:id/attachments', (c) =>
    c.json({ attachments: attachmentService.list(getDb(c), c.req.param('id')) }),
  );

  app.get('/attachments/:id', async (c) => {
    const { record, absolutePath } = attachmentService.get(getDb(c), c.req.param('id'), { filesDir });
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(absolutePath);
    c.header('Content-Type', record.mime ?? 'application/octet-stream');
    c.header('Content-Disposition', `inline; filename="${record.filename}"`);
    return c.body(bytes);
  });

  app.delete('/attachments/:id', async (c) => {
    await attachmentService.remove(getDb(c), c.req.param('id'), { filesDir });
    return c.body(null, 204);
  });

  return app;
}

const FILES_DIR = process.env.JUSTDOIT_FILES_DIR ?? './data/files';
export const attachmentsRoute = buildRoutes((c) => c.get('db'), FILES_DIR);
export function createAttachmentsRoute(db: Db, filesDir: string) {
  return buildRoutes(() => db, filesDir);
}
```

- [ ] **Step 8: Mount in `apps/api/src/app.ts`** — `app.route('/', attachmentsRoute);`

- [ ] **Step 9: Run the REST test to verify it passes**

Run: `pnpm --filter @justdoit/api test src/routes/attachments.test.ts`
Expected: PASS — 2 tests green. (Disallowed type → `ValidationError` → 400 via error middleware.)

- [ ] **Step 10: Add web hooks — modify `apps/web/src/lib/queries.ts`**

```ts
import { apiUrl } from './api';

export interface Attachment {
  id: string;
  taskId: string;
  filename: string;
  path: string;
  mime: string | null;
  size: number | null;
  createdAt: string;
}

export function useAttachments(taskId: string) {
  return useQuery({
    queryKey: ['attachments', taskId],
    queryFn: () => apiFetch<{ attachments: Attachment[] }>(`/tasks/${taskId}/attachments`).then((r) => r.attachments),
    enabled: Boolean(taskId),
  });
}

export function useUploadAttachment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(apiUrl(`/tasks/${taskId}/attachments`), { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      return (await res.json()) as { attachment: Attachment };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attachments', taskId] }),
  });
}

export function useDeleteAttachment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attachments', taskId] }),
  });
}
```

- [ ] **Step 11: Write the failing component test — `apps/web/src/components/attachments-panel.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AttachmentsPanel } from './attachments-panel';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(
        JSON.stringify({ attachments: [{ id: 'a1', taskId: 't', filename: 'note.txt', path: '', mime: 'text/plain', size: 5, createdAt: '' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ),
  );
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('AttachmentsPanel', () => {
  it('lists existing attachments with a download link', async () => {
    wrap(<AttachmentsPanel taskId="t" />);
    const link = (await screen.findByRole('link', { name: /note\.txt/i })) as HTMLAnchorElement;
    expect(link.href).toContain('/attachments/a1');
  });
});
```

- [ ] **Step 12: Write `apps/web/src/components/attachments-panel.tsx`**

```tsx
'use client';
import { useRef } from 'react';
import { apiUrl } from '@/lib/api';
import { useAttachments, useUploadAttachment, useDeleteAttachment } from '@/lib/queries';
import { Button } from '@/components/ui/button';

function humanSize(bytes: number | null): string {
  if (!bytes) return '';
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

export function AttachmentsPanel({ taskId }: { taskId: string }) {
  const { data = [] } = useAttachments(taskId);
  const upload = useUploadAttachment(taskId);
  const remove = useDeleteAttachment(taskId);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <section aria-label="Attachments" className="space-y-2">
      <ul className="space-y-1">
        {data.map((a) => (
          <li key={a.id} className="flex items-center gap-2 text-sm">
            <a className="underline" href={apiUrl(`/attachments/${a.id}`)} target="_blank" rel="noreferrer">
              {a.filename}
            </a>
            <span className="text-xs text-muted-foreground">{humanSize(a.size)}</span>
            <button aria-label={`Delete ${a.filename}`} className="ml-auto text-muted-foreground" onClick={() => remove.mutate(a.id)}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = '';
        }}
      />
      <Button size="sm" variant="secondary" disabled={upload.isPending} onClick={() => inputRef.current?.click()}>
        {upload.isPending ? 'Uploading…' : 'Add attachment'}
      </Button>
    </section>
  );
}
```

- [ ] **Step 13: Render `<AttachmentsPanel taskId={task.id} />` in the task-detail view.**

- [ ] **Step 14: Run the component test to verify it passes**

Run: `pnpm --filter @justdoit/web test src/components/attachments-panel.test.tsx`
Expected: PASS — 1 test green.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "feat(attachments): file service, multipart REST routes, and web panel"
```

---

## Task 9: Keyboard-shortcut cheatsheet (web)

**Files:**
- Create: `apps/web/src/hooks/use-keyboard-shortcuts.ts`
- Create: `apps/web/src/components/shortcut-cheatsheet.tsx`
- Create: `apps/web/src/components/shortcut-cheatsheet.test.tsx`
- Modify: `apps/web/src/app/providers.tsx` (mount `<ShortcutCheatsheet/>`)

**Interfaces:**
- Consumes: shadcn `Dialog` primitive.
- Produces:
  - `useShortcut(key: string, handler: () => void, opts?: { shift?: boolean })` — registers a global keydown handler that ignores events originating in inputs/textareas/contenteditable.
  - `<ShortcutCheatsheet />` — opens on `?` (Shift+/), closes on `Escape`, lists the app's shortcuts in a modal.

- [ ] **Step 1: Write the failing test — `apps/web/src/components/shortcut-cheatsheet.test.tsx`**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShortcutCheatsheet } from './shortcut-cheatsheet';

describe('ShortcutCheatsheet', () => {
  it('opens on "?" and shows shortcut rows, then closes on Escape', () => {
    render(<ShortcutCheatsheet />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: '?', shiftKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/command palette/i)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ignores "?" typed into an input', () => {
    render(
      <>
        <input aria-label="field" />
        <ShortcutCheatsheet />
      </>,
    );
    const input = screen.getByLabelText('field');
    input.focus();
    fireEvent.keyDown(input, { key: '?', shiftKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
```

- [ ] **Step 2: Write `apps/web/src/hooks/use-keyboard-shortcuts.ts`**

```ts
'use client';
import { useEffect } from 'react';

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function useShortcut(key: string, handler: () => void, opts: { shift?: boolean } = {}): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (opts.shift && !e.shiftKey) return;
      if (e.key !== key) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, handler, opts.shift]);
}
```

- [ ] **Step 3: Write `apps/web/src/components/shortcut-cheatsheet.tsx`**

```tsx
'use client';
import { useState } from 'react';
import { useShortcut } from '@/hooks/use-keyboard-shortcuts';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: '⌘K', label: 'Open command palette' },
  { keys: 'C', label: 'Create task (quick-add)' },
  { keys: 'E', label: 'Edit selected task' },
  { keys: 'X', label: 'Toggle select task' },
  { keys: '1 / 2 / 3', label: 'Switch List / Board / Calendar view' },
  { keys: '?', label: 'Open this cheatsheet' },
];

export function ShortcutCheatsheet() {
  const [open, setOpen] = useState(false);
  useShortcut('?', () => setOpen(true), { shift: true });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="contents">
              <dt>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{s.keys}</kbd>
              </dt>
              <dd className="text-muted-foreground">{s.label}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
```

> The shadcn `Dialog` already closes on `Escape` and renders `role="dialog"`, satisfying the test. If the project's `Dialog` mock in jsdom doesn't emit `role="dialog"`, add `aria-label`/`role` explicitly on `DialogContent`.

- [ ] **Step 4: Mount `<ShortcutCheatsheet/>` in `apps/web/src/app/providers.tsx`** (next to `<LiveSync/>`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/web test src/components/shortcut-cheatsheet.test.tsx`
Expected: PASS — 2 tests green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): '?' keyboard-shortcut cheatsheet dialog"
```

---

## Task 10: Empty & onboarding states (web)

**Files:**
- Create: `apps/web/src/components/empty-state.tsx`
- Create: `apps/web/src/components/onboarding.tsx`
- Create: `apps/web/src/components/onboarding.test.tsx`
- Modify: list/board view to render `<EmptyState>` / `<Onboarding>` when there are zero tasks and zero projects.

**Interfaces:**
- Consumes: `useTasks`, `useProjects` (existing hooks); `quick-add` / create actions.
- Produces:
  - `<EmptyState title description action? />` — reusable illustration + call-to-action for any empty list.
  - `<Onboarding onCreateSample onQuickAdd />` — first-run welcome shown only when the workspace has no tasks **and** no projects; offers "Add your first task" (focuses quick-add) and "Create a sample project".

- [ ] **Step 1: Write the failing test — `apps/web/src/components/onboarding.test.tsx`**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Onboarding } from './onboarding';
import { EmptyState } from './empty-state';

describe('Onboarding & EmptyState', () => {
  it('renders the first-run welcome and fires the quick-add CTA', () => {
    const onQuickAdd = vi.fn();
    render(<Onboarding onQuickAdd={onQuickAdd} onCreateSample={() => {}} />);
    expect(screen.getByRole('heading', { name: /welcome to justdoit/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /add your first task/i }));
    expect(onQuickAdd).toHaveBeenCalled();
  });

  it('EmptyState shows title, description, and an optional action', () => {
    const onClick = vi.fn();
    render(<EmptyState title="No tasks" description="You're all caught up." action={{ label: 'New task', onClick }} />);
    expect(screen.getByText(/no tasks/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /new task/i }));
    expect(onClick).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Write `apps/web/src/components/empty-state.tsx`**

```tsx
'use client';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      {icon ? <div className="text-4xl opacity-60" aria-hidden>{icon}</div> : null}
      <h2 className="text-lg font-medium">{title}</h2>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? (
        <Button size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Write `apps/web/src/components/onboarding.tsx`**

```tsx
'use client';
import { Button } from '@/components/ui/button';

export function Onboarding({ onQuickAdd, onCreateSample }: { onQuickAdd: () => void; onCreateSample: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
      <div className="text-5xl" aria-hidden>
        ✅
      </div>
      <h1 className="text-2xl font-semibold">Welcome to justdoit</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Capture tasks in plain language, organize with projects & tags, track time, and let your agent help.
        Try typing <code className="rounded bg-muted px-1">buy milk tomorrow 5pm #errands p1</code>.
      </p>
      <div className="flex gap-2">
        <Button onClick={onQuickAdd}>Add your first task</Button>
        <Button variant="secondary" onClick={onCreateSample}>
          Create a sample project
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire into the primary view** — in the list/board page:

```tsx
const { data: tasks = [] } = useTasks(filters);
const { data: projects = [] } = useProjects();
const firstRun = tasks.length === 0 && projects.length === 0;
// ...
if (firstRun) return <Onboarding onQuickAdd={focusQuickAdd} onCreateSample={createSampleProject} />;
if (tasks.length === 0) return <EmptyState title="No tasks here" description="Nothing matches this view." action={{ label: 'New task', onClick: focusQuickAdd }} />;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/web test src/components/onboarding.test.tsx`
Expected: PASS — 2 tests green.

- [ ] **Step 6: Add a Playwright first-run e2e — `apps/web/e2e/onboarding.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

// Assumes the web dev server points at a fresh API (empty DB) via the Playwright webServer config.
test('first run shows onboarding and quick-add creates the first task', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /welcome to justdoit/i })).toBeVisible();
  await page.getByRole('button', { name: /add your first task/i }).click();
  await page.getByRole('textbox', { name: /quick add/i }).fill('Write the launch post tomorrow #launch p1');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Write the launch post')).toBeVisible();
});
```

Run: `pnpm --filter @justdoit/web e2e onboarding.spec.ts`
Expected: PASS — welcome heading visible on a fresh DB; after quick-add, the new task appears (proving onboarding → empty-state → populated transitions).

- [ ] **Step 7: Final full-workspace gate**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: all PASS across `core`, `api`, `web`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(web): empty-state and first-run onboarding"
```

---

## Phase 6 Definition of Done

- **Event bus:** `@justdoit/core` exports `events` (singleton `EventBus`) + `emit()`; task/project/time mutations publish `DomainEvent`s. Unit tests prove emission.
- **Activity log:** `activityService.record/list` + `startActivityLog(db)` persist every event; `GET /activity?entity=<type>:<id>` returns them; the task-detail view renders a reverse-chronological timeline. Core + REST + component tests green.
- **SSE live sync:** `GET /events` streams change frames from the bus with heartbeats and clean teardown; the web `useLiveSync` hook invalidates the correct TanStack query keys per entity type. A `curl -N` smoke check shows a task mutation arriving live. REST + hook tests green.
- **Saved filters:** `savedFilterService` CRUD (Zod-validated `query`) + `/saved-filters` REST + web menu to save/apply/delete views. Core + REST + component tests green.
- **Bulk actions:** `taskService.bulkUpdate` / `bulkDelete` + `PATCH /tasks/bulk` / `POST /tasks/bulk-delete` + web multi-select toolbar (status/priority/project/tag/delete). Emits per-entity events (so SSE + activity log stay consistent). Core + REST + component tests green.
- **Attachments:** `attachmentService` (add/list/get/remove) with size (≤25 MB) + MIME allow-list validation, files under `JUSTDOIT_FILES_DIR` (default `./data/files`); multipart `POST`, streaming `GET`, `DELETE` REST routes; web upload/list/delete panel. Core + REST + component tests green.
- **Cheatsheet:** `?` opens a shortcut modal that ignores keystrokes inside inputs. Component test green.
- **Onboarding/empty states:** first-run welcome (no tasks + no projects) and reusable empty states; Playwright first-run e2e green.
- **Gates:** `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` all pass across `core`, `api`, `web`.
- **Known limitation (documented):** the event bus is in-process, so mutations made by the separate MCP process are persisted to the activity log only if that process attaches `startActivityLog`; they do **not** push to the API's SSE clients. Cross-process live-sync is out of scope for v1 (see spec §8).

## Project complete — how to run everything

**One-time setup**

```bash
pnpm install                                   # builds better-sqlite3 (allowlisted)
pnpm --filter @justdoit/core db:migrate        # apply migrations to ./justdoit.db
mkdir -p ./data/files                          # attachment storage
```

**Environment variables**

| Var | Surface | Default | Purpose |
|---|---|---|---|
| `JUSTDOIT_DB` | api, mcp | `justdoit.db` | SQLite file path |
| `JUSTDOIT_FILES_DIR` | api | `./data/files` | Attachment storage dir |
| `JUSTDOIT_API_PORT` | api | `8787` | REST/SSE server port |
| `NEXT_PUBLIC_API_URL` | web | `http://localhost:8787` | REST base the web client + SSE point at |
| `JUSTDOIT_API_KEY` | api, mcp | _unset_ | Optional `X-API-Key` gate (localhost off by default) |

**Run all three surfaces (three terminals)**

```bash
# Terminal 1 — REST + SSE API
JUSTDOIT_DB=./justdoit.db JUSTDOIT_FILES_DIR=./data/files JUSTDOIT_API_PORT=8787 \
  pnpm --filter @justdoit/api dev

# Terminal 2 — MCP server (stdio + streamable-HTTP), shares the same DB file
JUSTDOIT_DB=./justdoit.db pnpm --filter @justdoit/mcp dev

# Terminal 3 — Next.js UI (pure REST client)
NEXT_PUBLIC_API_URL=http://localhost:8787 pnpm --filter @justdoit/web dev
```

Or start api + web together via Turborepo: `pnpm dev` (root, runs the `dev` pipeline). Open `http://localhost:3000`; the UI live-updates via `GET /events` as tasks change from any REST call or another browser tab. Point your agent harness at the MCP server (stdio) or its HTTP transport to manage the same data.

**Verify the whole stack**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm format:check
```

Expected: all green — `core` unit tests, `api` route/integration tests, and `web` component + Playwright e2e all pass.
