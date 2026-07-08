# Phase 3: Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scheduling to `justdoit` — due/start-date validation and date-window queries (`overdue`/`today`/`upcoming`), recurring tasks driven by RRULE (spawn-next-on-complete), and reminders with a `node-cron` background scheduler that fires local desktop notifications. All domain logic lands in `packages/core` (test-first, clock injected), thin REST adapters land in `apps/api`, and the scheduler's notifier is injectable so tests never fire a real notification.

**Architecture:** `packages/core` gains a pure `recurrence.ts` utility (wraps the `rrule` package), a `schedule-service` (date-window queries + window validation + recurrence spawn), a `reminder-service` (CRUD + due-reminder query), and matching Zod schemas. `apps/api` gains reminder REST routes, a `?due=` filter branch on the task-list route, and a `scheduler.ts` whose core tick (`runReminderTick`) is a plain injectable function; a `node-cron` job merely calls it every minute in production. No business rules live in `apps/api`. Every service method takes `(db, ...)` and every time-dependent method takes an injected `now: Date` — no real-clock dependence in tests.

**Tech Stack:** builds on Phase 0/1/2. New runtime deps: `rrule` (in `@justdoit/core`), `node-cron` + `node-notifier` (in `@justdoit/api`). Tests: Vitest 3 against in-memory SQLite (`createDb(':memory:')` + `runMigrations`).

## Global Constraints

- Node `>=22`; pnpm `10.4.1`. ESM everywhere (`"type": "module"`). Verbatim.
- TS config inherited from `tsconfig.base.json`: `moduleResolution: "Bundler"`, `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. Relative imports are **extensionless** (matches Phase 0 `./client`, `./schema`). Verbatim.
- ALL business logic + validation lives in `packages/core/src/services/` and `packages/core/src/recurrence.ts`; each function's first parameter is `db: Db`. Zod schemas live in `packages/core/src/schemas/`. Errors are consumed from the existing `packages/core/src/errors.ts` (`NotFoundError`, `ValidationError`, `ConflictError`) — do NOT define new error classes. Verbatim.
- **Clock injection:** any function whose result depends on the current time takes an explicit `now: Date` (services) or `now: () => Date` (scheduler). No `new Date()` inside testable logic. Verbatim.
- **No real notifications in tests.** The scheduler's notifier is an injectable `Notifier` interface; unit tests pass a fake. Tests never call `startReminderScheduler` (which wires `node-cron` + `node-notifier`); they only call `runReminderTick`. Verbatim.
- Recurrence uses the `rrule` package. To keep recurrence deterministic and TZ-independent, `nextOccurrence` and its tests use **UTC** `Date`s (ISO strings ending in `Z`); date-window queries (`today`) use **local** day boundaries, and their tests construct dates with the local `new Date(y, m, d, h)` constructor. Verbatim.
- REST reads its `Db` from the `JUSTDOIT_DB` env path via the Phase 1 app wiring; route handlers obtain the db from context (`c.get('db')`) and validate with `@hono/zod-validator`. Verbatim.
- Assumed from earlier phases (do NOT rebuild): `@justdoit/core` exports `createDb`, `runMigrations`, `Db`, all tables/enums/types (Phase 0); `taskService` (a plain object) with `create`, `get`, `list`, `update`, `setStatus`, `complete` methods and `errors.ts` (Phase 1); `apps/api` scaffolded with a `createApp(db: Db)` factory, `AppEnv` type (`{ Variables: { db: Db } }`), a `routes/` dir, error middleware, and `@hono/zod-validator` (Phase 1).

---

## File Structure

```
packages/core/
├── package.json                         # + rrule dependency
└── src/
    ├── recurrence.ts                    # NEW: rrule wrapper (validate + nextOccurrence)
    ├── recurrence.test.ts               # NEW
    ├── db/schema.ts                     # MODIFY: export Reminder/NewReminder types
    ├── errors.ts                        # (existing, consumed)
    ├── index.ts                         # MODIFY: re-export new modules
    ├── schemas/
    │   ├── schedule.ts                  # NEW: dueFilter enum, upcoming query
    │   └── reminder.ts                  # NEW: create/update reminder bodies
    └── services/
        ├── schedule-service.ts          # NEW: window validation, window queries, spawn
        ├── schedule-service.test.ts     # NEW
        ├── reminder-service.ts          # NEW: CRUD + dueReminders + markDelivered
        ├── reminder-service.test.ts     # NEW
        ├── task-service.ts              # MODIFY: complete() spawns next occurrence
        └── task-service.test.ts         # MODIFY: recurrence-on-complete cases

apps/api/
├── package.json                         # + node-cron, node-notifier (+ @types)
└── src/
    ├── scheduler.ts                     # NEW: Notifier, runReminderTick, startReminderScheduler
    ├── scheduler.test.ts                # NEW
    ├── app.ts                           # MODIFY: mount /reminders route
    ├── index.ts                         # MODIFY: start scheduler (guarded)
    └── routes/
        ├── reminders.ts                 # NEW: GET/POST /reminders, PATCH/DELETE /reminders/:id
        ├── reminders.test.ts            # NEW
        ├── tasks.ts                     # MODIFY: ?due=overdue|today|upcoming branch
        └── tasks.test.ts                # MODIFY: due-filter cases
```

---

## Task 1: Recurrence utility (`rrule` wrapper)

**Files:**

- Modify: `packages/core/package.json` (add `rrule`)
- Create: `packages/core/src/recurrence.ts`
- Create: `packages/core/src/recurrence.test.ts`
- Modify: `packages/core/src/index.ts` (re-export `./recurrence`)

**Interfaces:**

- Consumes: `rrule` package; `ValidationError` from `./errors`.
- Produces:
  - `isValidRecurrence(rule: string): boolean` — true iff `rule` is a parseable RRULE line.
  - `assertValidRecurrence(rule: string): void` — throws `ValidationError` on an unparseable rule.
  - `nextOccurrence(rule: string, after: Date): Date | null` — the first occurrence strictly after `after` (anchored at `after`), or `null` if the rule is finite and exhausted.

- [ ] **Step 1: Add the dependency — modify `packages/core/package.json`**

Add to `"dependencies"` (keep the existing Phase 0/1 deps):

```json
"rrule": "^2.8.1"
```

Then run: `pnpm install`
Expected: installs `rrule` (pure JS — no native build, no `onlyBuiltDependencies` entry needed). No "ignored build scripts" warning introduced.

- [ ] **Step 2: Write the failing test — `packages/core/src/recurrence.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { isValidRecurrence, assertValidRecurrence, nextOccurrence } from './recurrence';
import { ValidationError } from './errors';

describe('recurrence', () => {
  it('validates a good RRULE', () => {
    expect(isValidRecurrence('FREQ=DAILY')).toBe(true);
    expect(isValidRecurrence('FREQ=WEEKLY;BYDAY=MO,WE')).toBe(true);
  });

  it('rejects garbage', () => {
    expect(isValidRecurrence('not-a-rule')).toBe(false);
    expect(() => assertValidRecurrence('FREQ=NOPE')).toThrow(ValidationError);
  });

  it('computes the next daily occurrence after an anchor (UTC)', () => {
    const after = new Date('2026-01-05T09:00:00Z');
    const next = nextOccurrence('FREQ=DAILY', after);
    expect(next?.toISOString()).toBe('2026-01-06T09:00:00.000Z');
  });

  it('computes the next weekly occurrence', () => {
    // 2026-01-05 is a Monday.
    const after = new Date('2026-01-05T09:00:00Z');
    const next = nextOccurrence('FREQ=WEEKLY;BYDAY=MO', after);
    expect(next?.toISOString()).toBe('2026-01-12T09:00:00.000Z');
  });

  it('returns null when a finite rule is exhausted', () => {
    const after = new Date('2026-01-05T09:00:00Z');
    expect(nextOccurrence('FREQ=DAILY;COUNT=1', after)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/core test`
Expected: FAIL — cannot resolve `./recurrence`.

- [ ] **Step 4: Write the implementation — `packages/core/src/recurrence.ts`**

```ts
import { RRule } from 'rrule';
import { ValidationError } from './errors';

export function isValidRecurrence(rule: string): boolean {
  try {
    new RRule(RRule.parseString(rule));
    return true;
  } catch {
    return false;
  }
}

export function assertValidRecurrence(rule: string): void {
  if (!isValidRecurrence(rule)) {
    throw new ValidationError(`Invalid recurrence rule: ${rule}`);
  }
}

export function nextOccurrence(rule: string, after: Date): Date | null {
  const options = RRule.parseString(rule);
  // Anchor the pattern at `after` so the result is deterministic and
  // independent of the current wall clock.
  options.dtstart = after;
  const rrule = new RRule(options);
  return rrule.after(after, false);
}
```

- [ ] **Step 5: Re-export from the package entry — modify `packages/core/src/index.ts`**

Add (alongside the existing Phase 0/1 exports):

```ts
export * from './recurrence';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/core test`
Expected: PASS — all recurrence tests green.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @justdoit/core typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): add rrule recurrence utility (nextOccurrence + validation)"
```

---

## Task 2: Schedule schemas + `schedule-service` window validation & queries

**Files:**

- Create: `packages/core/src/schemas/schedule.ts`
- Create: `packages/core/src/services/schedule-service.ts`
- Create: `packages/core/src/services/schedule-service.test.ts`
- Modify: `packages/core/src/index.ts` (re-export new modules)

**Interfaces:**

- Consumes: `Db` and the `tasks` table from `../db`; `ValidationError` from `../errors`; `Task` type.
- Produces:
  - `dueFilterSchema = z.enum(['overdue', 'today', 'upcoming'])`; `type DueFilter`.
  - `upcomingQuerySchema = z.object({ days: z.coerce.number().int().positive().max(365).default(7) })`.
  - `assertValidWindow(window: { startAt?: Date | null; dueAt?: Date | null }): void` — throws `ValidationError` if both are set and `startAt > dueAt`.
  - `listOverdue(db: Db, now: Date): Task[]` — `dueAt < now`, status not `done`/`cancelled`, not archived, ordered by `dueAt` asc.
  - `listDueToday(db: Db, now: Date): Task[]` — `dueAt` within the **local** calendar day of `now`, same status/archive filter, ordered by `dueAt` asc.
  - `listUpcoming(db: Db, now: Date, days = 7): Task[]` — `dueAt` in `(now, endOfLocalDay(now + days)]`, same filter, ordered by `dueAt` asc.
  - (`spawnNextRecurrence` is added to this same file in Task 4.)

- [ ] **Step 1: Write the schemas — `packages/core/src/schemas/schedule.ts`**

```ts
import { z } from 'zod';

export const dueFilterSchema = z.enum(['overdue', 'today', 'upcoming']);
export type DueFilter = z.infer<typeof dueFilterSchema>;

export const upcomingQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).default(7),
});
export type UpcomingQuery = z.infer<typeof upcomingQuerySchema>;
```

- [ ] **Step 2: Write the failing test — `packages/core/src/services/schedule-service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations } from '../db/client';
import { tasks } from '../db/schema';
import type { Db } from '../db/client';
import { ValidationError } from '../errors';
import { assertValidWindow, listOverdue, listDueToday, listUpcoming } from './schedule-service';

function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

function makeTask(db: Db, title: string, dueAt: Date | null, status = 'todo' as const) {
  const [row] = db.insert(tasks).values({ title, dueAt, status }).returning().all();
  return row!;
}

describe('schedule-service window validation', () => {
  it('accepts a window where startAt <= dueAt', () => {
    expect(() =>
      assertValidWindow({
        startAt: new Date('2026-01-01T00:00:00Z'),
        dueAt: new Date('2026-01-02T00:00:00Z'),
      }),
    ).not.toThrow();
  });

  it('accepts partial windows', () => {
    expect(() => assertValidWindow({ dueAt: new Date() })).not.toThrow();
    expect(() => assertValidWindow({})).not.toThrow();
  });

  it('rejects startAt after dueAt', () => {
    expect(() =>
      assertValidWindow({
        startAt: new Date('2026-01-03T00:00:00Z'),
        dueAt: new Date('2026-01-02T00:00:00Z'),
      }),
    ).toThrow(ValidationError);
  });
});

describe('schedule-service window queries', () => {
  let db: Db;
  // Use LOCAL calendar dates so "today" is TZ-independent for the test machine.
  const now = new Date(2026, 0, 15, 12, 0, 0); // 2026-01-15 12:00 local

  beforeEach(() => {
    db = freshDb();
  });

  it('listOverdue returns only past-due, non-terminal tasks', () => {
    makeTask(db, 'yesterday', new Date(2026, 0, 14, 9, 0, 0));
    makeTask(db, 'done-overdue', new Date(2026, 0, 14, 9, 0, 0), 'done');
    makeTask(db, 'tomorrow', new Date(2026, 0, 16, 9, 0, 0));
    makeTask(db, 'no-due', null);
    const overdue = listOverdue(db, now);
    expect(overdue.map((t) => t.title)).toEqual(['yesterday']);
  });

  it('listDueToday returns tasks due within the local day', () => {
    makeTask(db, 'early-today', new Date(2026, 0, 15, 8, 0, 0));
    makeTask(db, 'late-today', new Date(2026, 0, 15, 23, 30, 0));
    makeTask(db, 'yesterday', new Date(2026, 0, 14, 9, 0, 0));
    makeTask(db, 'tomorrow', new Date(2026, 0, 16, 9, 0, 0));
    const today = listDueToday(db, now);
    expect(today.map((t) => t.title)).toEqual(['early-today', 'late-today']);
  });

  it('listUpcoming returns tasks due after now through now+days', () => {
    makeTask(db, 'in-2-days', new Date(2026, 0, 17, 9, 0, 0));
    makeTask(db, 'in-7-days', new Date(2026, 0, 22, 9, 0, 0));
    makeTask(db, 'in-30-days', new Date(2026, 1, 14, 9, 0, 0));
    makeTask(db, 'past', new Date(2026, 0, 10, 9, 0, 0));
    const upcoming = listUpcoming(db, now, 7);
    expect(upcoming.map((t) => t.title)).toEqual(['in-2-days', 'in-7-days']);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/core test`
Expected: FAIL — cannot resolve `./schedule-service`.

- [ ] **Step 4: Write the implementation — `packages/core/src/services/schedule-service.ts`**

```ts
import { and, asc, gt, gte, lt, lte, notInArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { tasks, type Task } from '../db/schema';
import { ValidationError } from '../errors';

const TERMINAL_STATUSES = ['done', 'cancelled'] as const;

export interface ScheduleWindow {
  startAt?: Date | null;
  dueAt?: Date | null;
}

export function assertValidWindow(window: ScheduleWindow): void {
  const { startAt, dueAt } = window;
  if (startAt && dueAt && startAt.getTime() > dueAt.getTime()) {
    throw new ValidationError('startAt must be on or before dueAt');
  }
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

const activeAndDue = () => notInArray(tasks.status, TERMINAL_STATUSES);

export function listOverdue(db: Db, now: Date): Task[] {
  return db
    .select()
    .from(tasks)
    .where(and(lt(tasks.dueAt, now), activeAndDue()))
    .orderBy(asc(tasks.dueAt))
    .all();
}

export function listDueToday(db: Db, now: Date): Task[] {
  return db
    .select()
    .from(tasks)
    .where(
      and(
        gte(tasks.dueAt, startOfLocalDay(now)),
        lte(tasks.dueAt, endOfLocalDay(now)),
        activeAndDue(),
      ),
    )
    .orderBy(asc(tasks.dueAt))
    .all();
}

export function listUpcoming(db: Db, now: Date, days = 7): Task[] {
  const end = endOfLocalDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  return db
    .select()
    .from(tasks)
    .where(and(gt(tasks.dueAt, now), lte(tasks.dueAt, end), activeAndDue()))
    .orderBy(asc(tasks.dueAt))
    .all();
}
```

> Note: `notInArray` excludes rows where `status` is terminal; SQLite `NULL dueAt` rows are excluded automatically by the `<`/`>`/`between` comparisons (NULL never satisfies them), which is the desired behavior.

- [ ] **Step 5: Re-export — modify `packages/core/src/index.ts`**

Add:

```ts
export * from './schemas/schedule';
export * from './services/schedule-service';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/core test`
Expected: PASS — window validation + all three query suites green.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @justdoit/core typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): add schedule-service window validation and due-window queries"
```

---

## Task 3: Wire due/start + recurrence validation into task create/update

**Files:**

- Modify: `packages/core/src/services/task-service.ts` (call validators in `taskService.create`/`taskService.update`)
- Modify: `packages/core/src/services/task-service.test.ts` (add validation cases)

**Interfaces:**

- Consumes: `assertValidWindow` (Task 2), `assertValidRecurrence` (Task 1).
- Produces: `taskService.create`/`taskService.update` now throw `ValidationError` when `startAt > dueAt`, or when a non-null `recurrence` string is unparseable. Signatures unchanged.

- [ ] **Step 1: Add failing tests — modify `packages/core/src/services/task-service.test.ts`**

Append inside the existing `describe('task-service', ...)`:

```ts
it('rejects creating a task whose startAt is after dueAt', () => {
  expect(() =>
    taskService.create(db, {
      title: 'bad window',
      startAt: new Date('2026-02-02T00:00:00Z'),
      dueAt: new Date('2026-02-01T00:00:00Z'),
    }),
  ).toThrow(ValidationError);
});

it('rejects creating a task with an invalid recurrence', () => {
  expect(() => taskService.create(db, { title: 'bad rule', recurrence: 'FREQ=NOPE' })).toThrow(
    ValidationError,
  );
});

it('accepts a valid recurrence', () => {
  const task = taskService.create(db, { title: 'daily standup', recurrence: 'FREQ=DAILY' });
  expect(task.recurrence).toBe('FREQ=DAILY');
});
```

(Ensure `ValidationError` is imported in the test file; add `import { ValidationError } from '../errors';` if not already present.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @justdoit/core test`
Expected: FAIL — no validation is performed yet (task is created instead of throwing).

- [ ] **Step 3: Wire validators — modify `packages/core/src/services/task-service.ts`**

Add imports at the top:

```ts
import { assertValidWindow } from './schedule-service';
import { assertValidRecurrence } from '../recurrence';
```

In `taskService.create`, immediately after computing/receiving `input` and before the DB insert, add:

```ts
assertValidWindow({ startAt: input.startAt ?? null, dueAt: input.dueAt ?? null });
if (input.recurrence != null) assertValidRecurrence(input.recurrence);
```

In `taskService.update`, after loading the existing row (`existing`) and before the DB update, add a merged-window check:

```ts
assertValidWindow({
  startAt: 'startAt' in input ? (input.startAt ?? null) : existing.startAt,
  dueAt: 'dueAt' in input ? (input.dueAt ?? null) : existing.dueAt,
});
if (input.recurrence != null) assertValidRecurrence(input.recurrence);
```

> Adapt the exact variable names (`input`, `existing`) to the Phase 1 implementation; the intent is: validate the effective window and any non-null recurrence before persisting.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @justdoit/core test`
Expected: PASS — new validation cases green, all Phase 1 task tests still green.

- [ ] **Step 5: Typecheck & commit**

Run: `pnpm --filter @justdoit/core typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat(core): validate due/start window and recurrence on task create/update"
```

---

## Task 4: Spawn next occurrence on complete

**Files:**

- Modify: `packages/core/src/services/schedule-service.ts` (add `spawnNextRecurrence`)
- Modify: `packages/core/src/services/task-service.ts` (`complete` spawns next)
- Modify: `packages/core/src/services/task-service.test.ts` (recurrence-on-complete cases)

**Interfaces:**

- Consumes: `nextOccurrence` (Task 1); `tasks` table.
- Produces:
  - `spawnNextRecurrence(db: Db, task: Task, now: Date): Task | null` — if `task.recurrence` is set and not exhausted, inserts a fresh task copying `title`, `description`, `priority`, `projectId`, `parentTaskId`, `position`, `estimateMinutes`, `recurrence`; sets `status: 'todo'`, `completedAt: null`; shifts `dueAt`/`startAt` forward by `nextOccurrence(recurrence, anchor) - anchor` where `anchor = task.dueAt ?? task.startAt ?? now`. Returns the new task or `null`.
  - `taskService.complete(db, id, now?)` (Phase 1 signature `complete(db, id, now?: Date)` preserved) now calls `spawnNextRecurrence` after marking the task done; the spawned task (if any) is created as a side effect. Phase 3 is the source of truth for where recurrence spawning is triggered: inside `taskService.complete`.

- [ ] **Step 1: Add failing tests — modify `packages/core/src/services/task-service.test.ts`**

```ts
it('spawns the next occurrence when completing a recurring task', () => {
  const now = new Date('2026-03-02T10:00:00Z');
  const task = taskService.create(db, {
    title: 'water plants',
    recurrence: 'FREQ=WEEKLY;BYDAY=MO',
    dueAt: new Date('2026-03-02T09:00:00Z'), // a Monday
  });
  taskService.complete(db, task.id, now);

  const open = taskService.list(db, { status: 'todo' });
  const spawned = open.find((t) => t.title === 'water plants');
  expect(spawned).toBeDefined();
  expect(spawned!.id).not.toBe(task.id);
  expect(spawned!.dueAt?.toISOString()).toBe('2026-03-09T09:00:00.000Z');
  expect(spawned!.recurrence).toBe('FREQ=WEEKLY;BYDAY=MO');
  expect(spawned!.completedAt).toBeNull();
});

it('does not spawn for a non-recurring task', () => {
  const now = new Date('2026-03-02T10:00:00Z');
  const task = taskService.create(db, {
    title: 'one-off',
    dueAt: new Date('2026-03-02T09:00:00Z'),
  });
  taskService.complete(db, task.id, now);
  const open = taskService.list(db, { status: 'todo' });
  expect(open.find((t) => t.title === 'one-off')).toBeUndefined();
});
```

(`taskService.list` uses the Phase 1 `TaskListFilters` shape; the check is "a new open task with the same title and the next dueAt exists".)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @justdoit/core test`
Expected: FAIL — no spawned task is created.

- [ ] **Step 3: Add `spawnNextRecurrence` — modify `packages/core/src/services/schedule-service.ts`**

Add imports:

```ts
import { nextOccurrence } from '../recurrence';
```

Append:

```ts
export function spawnNextRecurrence(db: Db, task: Task, now: Date): Task | null {
  if (!task.recurrence) return null;
  const anchor = task.dueAt ?? task.startAt ?? now;
  const next = nextOccurrence(task.recurrence, anchor);
  if (!next) return null;
  const delta = next.getTime() - anchor.getTime();
  const [created] = db
    .insert(tasks)
    .values({
      title: task.title,
      description: task.description,
      status: 'todo',
      priority: task.priority,
      projectId: task.projectId,
      parentTaskId: task.parentTaskId,
      position: task.position,
      estimateMinutes: task.estimateMinutes,
      recurrence: task.recurrence,
      dueAt: task.dueAt ? new Date(task.dueAt.getTime() + delta) : null,
      startAt: task.startAt ? new Date(task.startAt.getTime() + delta) : null,
      completedAt: null,
    })
    .returning()
    .all();
  return created ?? null;
}
```

- [ ] **Step 4: Call it from `complete` — modify `packages/core/src/services/task-service.ts`**

Add import:

```ts
import { spawnNextRecurrence } from './schedule-service';
```

In `taskService.complete(db, id, now = new Date())`, after the row is marked done (and you hold the pre-completion row as `task` / the updated row), add before returning:

```ts
spawnNextRecurrence(db, task, now);
```

> Use the task row **as it was when recurring** (with its `recurrence` and original `dueAt`) as the argument, so the anchor is the original due date. Preserve the Phase 1 return value of `complete`.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @justdoit/core test`
Expected: PASS — spawn + no-spawn cases green; existing complete tests unaffected.

- [ ] **Step 6: Typecheck & commit**

Run: `pnpm --filter @justdoit/core typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat(core): spawn next occurrence when completing a recurring task"
```

---

## Task 5: Reminder schemas + `reminder-service`

**Files:**

- Modify: `packages/core/src/db/schema.ts` (export `Reminder`/`NewReminder` types)
- Create: `packages/core/src/schemas/reminder.ts`
- Create: `packages/core/src/services/reminder-service.ts`
- Create: `packages/core/src/services/reminder-service.test.ts`
- Modify: `packages/core/src/index.ts` (re-export new modules)

**Interfaces:**

- Consumes: `reminders` + `tasks` tables; `NotFoundError` from `../errors`.
- Produces:
  - schema.ts: `export type Reminder = typeof reminders.$inferSelect;` `export type NewReminder = typeof reminders.$inferInsert;`
  - `schemas/reminder.ts`: `createReminderBody = z.object({ taskId: z.string().uuid(), remindAt: z.coerce.date() })`; `updateReminderBody = z.object({ remindAt: z.coerce.date().optional(), delivered: z.boolean().optional() })`; inferred types `CreateReminderInput`, `UpdateReminderInput`.
  - `reminderService` (a plain object, matching the `projectService`/`tagService` convention) with methods:
    - `create(db: Db, input: CreateReminderInput): Reminder` — throws `NotFoundError` if `taskId` does not exist.
    - `get(db: Db, id: string): Reminder` — throws `NotFoundError`.
    - `list(db: Db, filter?: { taskId?: string; delivered?: boolean }): Reminder[]` — ordered by `remindAt` asc.
    - `update(db: Db, id: string, input: UpdateReminderInput): Reminder` — throws `NotFoundError`.
    - `remove(db: Db, id: string): void` — throws `NotFoundError` if nothing deleted.
    - `dueReminders(db: Db, now: Date): Reminder[]` — `delivered = false AND remindAt <= now`, ordered by `remindAt` asc.
    - `markDelivered(db: Db, id: string): Reminder` — sets `delivered = true`; throws `NotFoundError`.

- [ ] **Step 1: Export reminder types — modify `packages/core/src/db/schema.ts`**

Add next to the other inferred-type exports:

```ts
export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;
```

- [ ] **Step 2: Write the schemas — `packages/core/src/schemas/reminder.ts`**

```ts
import { z } from 'zod';

export const createReminderBody = z.object({
  taskId: z.string().uuid(),
  remindAt: z.coerce.date(),
});
export type CreateReminderInput = z.infer<typeof createReminderBody>;

export const updateReminderBody = z
  .object({
    remindAt: z.coerce.date().optional(),
    delivered: z.boolean().optional(),
  })
  .refine((v) => v.remindAt !== undefined || v.delivered !== undefined, {
    message: 'At least one field is required',
  });
export type UpdateReminderInput = z.infer<typeof updateReminderBody>;
```

- [ ] **Step 3: Write the failing test — `packages/core/src/services/reminder-service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations } from '../db/client';
import { tasks } from '../db/schema';
import type { Db } from '../db/client';
import { NotFoundError } from '../errors';
import { reminderService } from './reminder-service';

function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

function makeTask(db: Db, title = 'task'): string {
  const [row] = db.insert(tasks).values({ title }).returning().all();
  return row!.id;
}

describe('reminder-service', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });

  it('creates and gets a reminder', () => {
    const taskId = makeTask(db);
    const r = reminderService.create(db, { taskId, remindAt: new Date('2026-04-01T09:00:00Z') });
    expect(r.delivered).toBe(false);
    expect(reminderService.get(db, r.id).id).toBe(r.id);
  });

  it('rejects a reminder for a missing task', () => {
    expect(() =>
      reminderService.create(db, {
        taskId: '00000000-0000-0000-0000-000000000000',
        remindAt: new Date(),
      }),
    ).toThrow(NotFoundError);
  });

  it('lists and filters reminders', () => {
    const taskId = makeTask(db);
    reminderService.create(db, { taskId, remindAt: new Date('2026-04-02T09:00:00Z') });
    reminderService.create(db, { taskId, remindAt: new Date('2026-04-01T09:00:00Z') });
    const all = reminderService.list(db, { taskId });
    expect(all.map((r) => r.remindAt.toISOString())).toEqual([
      '2026-04-01T09:00:00.000Z',
      '2026-04-02T09:00:00.000Z',
    ]);
  });

  it('updates and deletes a reminder', () => {
    const taskId = makeTask(db);
    const r = reminderService.create(db, { taskId, remindAt: new Date('2026-04-01T09:00:00Z') });
    const updated = reminderService.update(db, r.id, {
      remindAt: new Date('2026-04-05T09:00:00Z'),
    });
    expect(updated.remindAt.toISOString()).toBe('2026-04-05T09:00:00.000Z');
    reminderService.remove(db, r.id);
    expect(() => reminderService.get(db, r.id)).toThrow(NotFoundError);
  });

  it('returns only undelivered reminders at/under now', () => {
    const taskId = makeTask(db);
    const now = new Date('2026-04-10T12:00:00Z');
    const past = reminderService.create(db, { taskId, remindAt: new Date('2026-04-10T11:00:00Z') });
    reminderService.create(db, { taskId, remindAt: new Date('2026-04-10T13:00:00Z') }); // future
    const alreadyDone = reminderService.create(db, {
      taskId,
      remindAt: new Date('2026-04-10T10:00:00Z'),
    });
    reminderService.markDelivered(db, alreadyDone.id);

    const due = reminderService.dueReminders(db, now);
    expect(due.map((r) => r.id)).toEqual([past.id]);
  });

  it('markDelivered flips the flag', () => {
    const taskId = makeTask(db);
    const r = reminderService.create(db, { taskId, remindAt: new Date('2026-04-01T09:00:00Z') });
    expect(reminderService.markDelivered(db, r.id).delivered).toBe(true);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm --filter @justdoit/core test`
Expected: FAIL — cannot resolve `./reminder-service`.

- [ ] **Step 5: Write the implementation — `packages/core/src/services/reminder-service.ts`**

```ts
import { and, asc, eq, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { reminders, tasks, type Reminder } from '../db/schema';
import { NotFoundError } from '../errors';
import type { CreateReminderInput, UpdateReminderInput } from '../schemas/reminder';

function requireTask(db: Db, taskId: string): void {
  const [row] = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).all();
  if (!row) throw new NotFoundError(`Task not found: ${taskId}`);
}

export const reminderService = {
  create(db: Db, input: CreateReminderInput): Reminder {
    requireTask(db, input.taskId);
    const [row] = db
      .insert(reminders)
      .values({ taskId: input.taskId, remindAt: input.remindAt })
      .returning()
      .all();
    return row!;
  },

  get(db: Db, id: string): Reminder {
    const [row] = db.select().from(reminders).where(eq(reminders.id, id)).all();
    if (!row) throw new NotFoundError(`Reminder not found: ${id}`);
    return row;
  },

  list(db: Db, filter: { taskId?: string; delivered?: boolean } = {}): Reminder[] {
    const conditions = [];
    if (filter.taskId !== undefined) conditions.push(eq(reminders.taskId, filter.taskId));
    if (filter.delivered !== undefined) conditions.push(eq(reminders.delivered, filter.delivered));
    return db
      .select()
      .from(reminders)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(reminders.remindAt))
      .all();
  },

  update(db: Db, id: string, input: UpdateReminderInput): Reminder {
    reminderService.get(db, id); // throws NotFoundError if missing
    const [row] = db
      .update(reminders)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(reminders.id, id))
      .returning()
      .all();
    return row!;
  },

  remove(db: Db, id: string): void {
    const deleted = db.delete(reminders).where(eq(reminders.id, id)).returning().all();
    if (deleted.length === 0) throw new NotFoundError(`Reminder not found: ${id}`);
  },

  dueReminders(db: Db, now: Date): Reminder[] {
    return db
      .select()
      .from(reminders)
      .where(and(eq(reminders.delivered, false), lte(reminders.remindAt, now)))
      .orderBy(asc(reminders.remindAt))
      .all();
  },

  markDelivered(db: Db, id: string): Reminder {
    reminderService.get(db, id);
    const [row] = db
      .update(reminders)
      .set({ delivered: true, updatedAt: new Date() })
      .where(eq(reminders.id, id))
      .returning()
      .all();
    return row!;
  },
};
```

- [ ] **Step 6: Re-export — modify `packages/core/src/index.ts`**

Add:

```ts
export * from './schemas/reminder';
export * from './services/reminder-service';
```

- [ ] **Step 7: Run to verify pass**

Run: `pnpm --filter @justdoit/core test`
Expected: PASS — all reminder-service cases green.

- [ ] **Step 8: Typecheck & commit**

Run: `pnpm --filter @justdoit/core typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat(core): add reminder-service (CRUD, dueReminders, markDelivered)"
```

---

## Task 6: REST reminder routes

**Files:**

- Create: `apps/api/src/routes/reminders.ts`
- Create: `apps/api/src/routes/reminders.test.ts`
- Modify: `apps/api/src/app.ts` (mount `/reminders`)

**Interfaces:**

- Consumes: `reminderService` (`create`/`list`/`update`/`remove`) + `createReminderBody`, `updateReminderBody` from `@justdoit/core`; the Phase 1 `AppEnv` (db on context) and error middleware (maps `NotFoundError`→404, `ValidationError`→400).
- Produces (all JSON):
  - `GET /reminders` — optional `?taskId=&delivered=true|false` → `Reminder[]`.
  - `POST /reminders` — body `{ taskId, remindAt }` → `201` `Reminder`.
  - `PATCH /reminders/:id` — body `{ remindAt?, delivered? }` → `Reminder`.
  - `DELETE /reminders/:id` → `204`.

- [ ] **Step 1: Write the failing test — `apps/api/src/routes/reminders.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '@justdoit/core';
import { tasks } from '@justdoit/core';
import { createApp } from '../app';

function setup(): { app: ReturnType<typeof createApp>; db: Db } {
  const { db } = createDb(':memory:');
  runMigrations(db);
  const app = createApp(db);
  return { app, db };
}

describe('reminders routes', () => {
  let app: ReturnType<typeof createApp>;
  let db: Db;
  let taskId: string;

  beforeEach(() => {
    ({ app, db } = setup());
    const [t] = db.insert(tasks).values({ title: 'ping me' }).returning().all();
    taskId = t!.id;
  });

  it('creates, lists, patches, and deletes a reminder', async () => {
    const created = await app.request('/reminders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId, remindAt: '2026-05-01T09:00:00Z' }),
    });
    expect(created.status).toBe(201);
    const reminder = await created.json();
    expect(reminder.delivered).toBe(false);

    const list = await app.request(`/reminders?taskId=${taskId}`);
    expect((await list.json()).length).toBe(1);

    const patched = await app.request(`/reminders/${reminder.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ delivered: true }),
    });
    expect((await patched.json()).delivered).toBe(true);

    const del = await app.request(`/reminders/${reminder.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
  });

  it('404s creating a reminder for a missing task', async () => {
    const res = await app.request('/reminders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        taskId: '00000000-0000-0000-0000-000000000000',
        remindAt: '2026-05-01T09:00:00Z',
      }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @justdoit/api test`
Expected: FAIL — `/reminders` not mounted (404 for the wrong reason / route missing).

- [ ] **Step 3: Write the route — `apps/api/src/routes/reminders.ts`**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { reminderService, createReminderBody, updateReminderBody } from '@justdoit/core';
import type { AppEnv } from '../app';

const listQuery = z.object({
  taskId: z.string().uuid().optional(),
  delivered: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const remindersRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', listQuery), (c) => {
    const db = c.get('db');
    return c.json(reminderService.list(db, c.req.valid('query')));
  })
  .post('/', zValidator('json', createReminderBody), (c) => {
    const db = c.get('db');
    return c.json(reminderService.create(db, c.req.valid('json')), 201);
  })
  .patch('/:id', zValidator('json', updateReminderBody), (c) => {
    const db = c.get('db');
    return c.json(reminderService.update(db, c.req.param('id'), c.req.valid('json')));
  })
  .delete('/:id', (c) => {
    const db = c.get('db');
    reminderService.remove(db, c.req.param('id'));
    return c.body(null, 204);
  });
```

- [ ] **Step 4: Mount it — modify `apps/api/src/app.ts`**

Add the import and mount (mirroring how Phase 1 mounts `/tasks`):

```ts
import { remindersRoutes } from './routes/reminders';
// inside createApp, after other .route(...) calls:
app.route('/reminders', remindersRoutes);
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @justdoit/api test`
Expected: PASS — reminder CRUD + 404 case green.

- [ ] **Step 6: Typecheck & commit**

Run: `pnpm --filter @justdoit/api typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat(api): add /reminders REST routes"
```

---

## Task 7: `?due=` filter on the task-list route

**Files:**

- Modify: `apps/api/src/routes/tasks.ts` (add `due` query branch)
- Modify: `apps/api/src/routes/tasks.test.ts` (due-filter cases)

**Interfaces:**

- Consumes: `listOverdue`, `listDueToday`, `listUpcoming`, `dueFilterSchema` from `@justdoit/core`.
- Produces: `GET /tasks?due=overdue|today|upcoming[&days=N]` → `Task[]`. When `due` is present it short-circuits to the corresponding schedule query using server clock `new Date()`; `days` (default 7) applies only to `upcoming`. Absent `due` preserves the Phase 1 list behavior unchanged.

- [ ] **Step 1: Add failing tests — modify `apps/api/src/routes/tasks.test.ts`**

```ts
it('filters tasks by due=overdue', async () => {
  const past = new Date(Date.now() - 86_400_000);
  db.insert(tasks).values({ title: 'late', dueAt: past }).run();
  db.insert(tasks).values({ title: 'no-due' }).run();
  const res = await app.request('/tasks?due=overdue');
  const body = await res.json();
  expect(body.map((t: { title: string }) => t.title)).toEqual(['late']);
});

it('filters tasks by due=upcoming with days', async () => {
  const inThree = new Date(Date.now() + 3 * 86_400_000);
  const inTen = new Date(Date.now() + 10 * 86_400_000);
  db.insert(tasks).values({ title: 'soon', dueAt: inThree }).run();
  db.insert(tasks).values({ title: 'later', dueAt: inTen }).run();
  const res = await app.request('/tasks?due=upcoming&days=7');
  const body = await res.json();
  expect(body.map((t: { title: string }) => t.title)).toEqual(['soon']);
});
```

(Use the `tasks` table import + the app/db setup already present in the Phase 1 tasks route test.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @justdoit/api test`
Expected: FAIL — `due` is ignored; overdue filter returns all tasks.

- [ ] **Step 3: Add the branch — modify `apps/api/src/routes/tasks.ts`**

Extend the list-query schema (merge into the existing Phase 1 query schema) and branch in the `GET /` handler:

```ts
import { dueFilterSchema, listOverdue, listDueToday, listUpcoming } from '@justdoit/core';

// add to the existing list query zod object:
//   due: dueFilterSchema.optional(),
//   days: z.coerce.number().int().positive().max(365).optional(),

// at the top of the GET '/' handler, before the normal list logic:
const q = c.req.valid('query');
if (q.due) {
  const db = c.get('db');
  const now = new Date();
  const result =
    q.due === 'overdue'
      ? listOverdue(db, now)
      : q.due === 'today'
        ? listDueToday(db, now)
        : listUpcoming(db, now, q.days ?? 7);
  return c.json(result);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @justdoit/api test`
Expected: PASS — overdue + upcoming filters green; existing list tests unaffected.

- [ ] **Step 5: Typecheck & commit**

Run: `pnpm --filter @justdoit/api typecheck`
Expected: PASS.

```bash
git add -A
git commit -m "feat(api): add ?due=overdue|today|upcoming task-list filter"
```

---

## Task 8: Reminder scheduler (`node-cron` + injectable `node-notifier`)

**Files:**

- Modify: `apps/api/package.json` (add `node-cron`, `node-notifier`, `@types/node-cron`, `@types/node-notifier`)
- Create: `apps/api/src/scheduler.ts`
- Create: `apps/api/src/scheduler.test.ts`
- Modify: `apps/api/src/index.ts` (start scheduler, guarded)

**Interfaces:**

- Consumes: `reminderService` (`dueReminders`/`markDelivered`), `taskService` (`get`), `Db` from `@justdoit/core`.
- Produces:
  - `interface Notifier { notify(input: { title: string; message: string }): void }`.
  - `desktopNotifier: Notifier` — real implementation delegating to `node-notifier`.
  - `runReminderTick(db: Db, notifier: Notifier, now: Date): number` — for each due reminder: notify (`title: 'justdoit'`, `message: <task title>`), `markDelivered`, return the count fired. **Pure/injectable — the unit-test entry point.**
  - `startReminderScheduler(opts: { db: Db; notifier?: Notifier; now?: () => Date; schedule?: string }): ScheduledTask` — wires a `node-cron` job (default `'* * * * *'`, every minute) calling `runReminderTick`. Defaults `notifier` to `desktopNotifier`, `now` to `() => new Date()`.

- [ ] **Step 1: Add deps — modify `apps/api/package.json`**

Add to `"dependencies"`:

```json
"node-cron": "^3.0.3",
"node-notifier": "^10.0.1"
```

Add to `"devDependencies"`:

```json
"@types/node-cron": "^3.0.11",
"@types/node-notifier": "^8.0.5"
```

Then run: `pnpm install`
Expected: installs cleanly. **No `onlyBuiltDependencies` change required** — `node-cron` and `rrule` are pure JS; `node-notifier` ships prebuilt platform helpers (e.g. `terminal-notifier` on macOS) and has no compile step. If pnpm ever reports an ignored build script for `node-notifier`, it is safe to leave ignored (the bundled binaries still work).

- [ ] **Step 2: Write the failing test — `apps/api/src/scheduler.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createDb, runMigrations, tasks, reminderService } from '@justdoit/core';
import { runReminderTick, type Notifier } from './scheduler';

function setup() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  const [task] = db.insert(tasks).values({ title: 'stand up' }).returning().all();
  return { db, taskId: task!.id };
}

class FakeNotifier implements Notifier {
  sent: { title: string; message: string }[] = [];
  notify(input: { title: string; message: string }): void {
    this.sent.push(input);
  }
}

describe('runReminderTick', () => {
  it('fires + marks due reminders and leaves future ones alone', () => {
    const { db, taskId } = setup();
    const now = new Date('2026-06-01T12:00:00Z');
    const due = reminderService.create(db, { taskId, remindAt: new Date('2026-06-01T11:00:00Z') });
    const future = reminderService.create(db, {
      taskId,
      remindAt: new Date('2026-06-01T13:00:00Z'),
    });
    const notifier = new FakeNotifier();

    const count = runReminderTick(db, notifier, now);

    expect(count).toBe(1);
    expect(notifier.sent).toEqual([{ title: 'justdoit', message: 'stand up' }]);
    expect(reminderService.get(db, due.id).delivered).toBe(true);
    expect(reminderService.get(db, future.id).delivered).toBe(false);
  });

  it('is idempotent — a second tick fires nothing', () => {
    const { db, taskId } = setup();
    const now = new Date('2026-06-01T12:00:00Z');
    reminderService.create(db, { taskId, remindAt: new Date('2026-06-01T11:00:00Z') });
    const notifier = new FakeNotifier();
    runReminderTick(db, notifier, now);
    expect(runReminderTick(db, notifier, now)).toBe(0);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @justdoit/api test`
Expected: FAIL — cannot resolve `./scheduler`.

- [ ] **Step 4: Write the implementation — `apps/api/src/scheduler.ts`**

```ts
import cron, { type ScheduledTask } from 'node-cron';
import notifier from 'node-notifier';
import { reminderService, taskService, type Db } from '@justdoit/core';

export interface Notifier {
  notify(input: { title: string; message: string }): void;
}

export const desktopNotifier: Notifier = {
  notify({ title, message }) {
    notifier.notify({ title, message });
  },
};

export function runReminderTick(db: Db, notify: Notifier, now: Date): number {
  const due = reminderService.dueReminders(db, now);
  for (const reminder of due) {
    const task = taskService.get(db, reminder.taskId);
    notify.notify({ title: 'justdoit', message: task.title });
    reminderService.markDelivered(db, reminder.id);
  }
  return due.length;
}

export interface SchedulerOptions {
  db: Db;
  notifier?: Notifier;
  now?: () => Date;
  schedule?: string;
}

export function startReminderScheduler(opts: SchedulerOptions): ScheduledTask {
  const {
    db,
    notifier: n = desktopNotifier,
    now = () => new Date(),
    schedule = '* * * * *',
  } = opts;
  return cron.schedule(schedule, () => {
    runReminderTick(db, n, now());
  });
}
```

- [ ] **Step 5: Start it in production — modify `apps/api/src/index.ts`**

After the server is created and `db` is available, add a guarded start (tests never import this entry, but guard anyway so scripted/CI runs stay silent):

```ts
import { startReminderScheduler } from './scheduler';
// after db + server setup:
if (process.env.JUSTDOIT_DISABLE_SCHEDULER !== '1') {
  startReminderScheduler({ db });
}
```

- [ ] **Step 6: Run to verify pass**

Run: `pnpm --filter @justdoit/api test`
Expected: PASS — tick fires the fake notifier once, marks delivered, second tick returns 0. **No real desktop notification appears** (tests use `runReminderTick` with `FakeNotifier`; `node-notifier` is never invoked).

- [ ] **Step 7: Full workspace gates**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api): add node-cron reminder scheduler with injectable notifier"
```

---

## Phase 3 Definition of Done

- `rrule` (core) and `node-cron` + `node-notifier` (+ `@types`) (api) are installed; `pnpm install` succeeds with no new `onlyBuiltDependencies` requirement.
- `nextOccurrence` / `isValidRecurrence` / `assertValidRecurrence` unit-tested with fixed UTC dates (daily, weekly, finite-exhausted).
- `taskService.create`/`taskService.update` reject `startAt > dueAt` and invalid RRULE strings (`ValidationError`).
- Completing a task with a `recurrence` spawns a fresh `todo` task with the next `dueAt`/`startAt` and preserved recurrence; non-recurring completes spawn nothing.
- `schedule-service` exposes `listOverdue` / `listDueToday` / `listUpcoming` with injected `now`, excluding terminal-status and null-due tasks; all green.
- `reminderService` exposes `create` (task-existence checked), `get`, `list`, `update`, `remove`, `dueReminders(db, now)`, `markDelivered`; all green.
- REST: `GET/POST /reminders`, `PATCH/DELETE /reminders/:id`, and `GET /tasks?due=overdue|today|upcoming[&days=N]` work against an in-memory DB; 404 on missing task.
- Scheduler: `runReminderTick` fires + marks due reminders and is idempotent, verified with a fake notifier; `startReminderScheduler` wires a one-minute `node-cron` job in production, guarded by `JUSTDOIT_DISABLE_SCHEDULER`. No test fires a real notification.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all pass.

## Notes for later phases

- **MCP (Phase 4):** `set_reminder` maps to `reminderService.create`; resources `tasks://today` / `tasks://overdue` map to `listDueToday` / `listOverdue`. Recurrence spawn is already automatic via `taskService.complete`, so `complete_task` needs no MCP-specific logic.
- **UI (Phase 5):** the calendar/agenda views consume `?due=` filters and `/reminders`; expose a recurrence picker that emits RRULE strings validated by `assertValidRecurrence` (surface `ValidationError` messages inline).
- **Notifications:** `Notifier` is a seam — a future phase can add email/push transports or a multiplexing notifier without touching `runReminderTick`. Consider a per-run cap and dedupe if reminder volume grows.
- **Timezones:** recurrence math is UTC-anchored; the local-day window queries assume the API process runs in the user's timezone (correct for a local-first desktop app). Revisit if a hosted/multi-TZ mode is ever added (explicitly out of scope per spec §8).
- **Scheduler robustness:** the one-minute cron reads server wall-clock; if the machine sleeps, missed reminders still fire on the next tick because `dueReminders` uses `remindAt <= now` (no lower bound). Consider surfacing "was overdue" context in the notification later.
