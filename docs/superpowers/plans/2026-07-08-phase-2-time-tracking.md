# Phase 2: Time Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `justdoit` full time tracking on top of the Phase 1 core + REST surface: start/stop timers with a single-running-timer guarantee, manual time entries (explicit end or explicit duration), entry management (list/update/delete), and time reports (totals grouped by day/project/tag plus per-task estimate-vs-actual), all proven by passing Vitest suites in `@justdoit/core` and `apps/api`.

**Architecture:** All time-tracking business logic lives in `@justdoit/core` as two service objects — `timeService` (`packages/core/src/services/time-service.ts`) and `reportService` (`packages/core/src/services/report-service.ts`) — whose methods take `(db: Db, ...)`. Zod schemas live in `packages/core/src/schemas/`. `apps/api` adds thin Hono routes that validate input with `@hono/zod-validator`, call the services, and let the Phase 1 error middleware map domain errors to HTTP status codes. MCP and UI (later phases) reuse the exact same services and schemas.

**Tech Stack:** TypeScript 5.7 (strict), Drizzle ORM + `better-sqlite3`, Zod 3, Vitest 3, Hono 4, `@hono/zod-validator`.

## Global Constraints

- Node `>=22`; ESM everywhere (`"type": "module"`). TS `strict`, `noUncheckedIndexedAccess`, `moduleResolution: "Bundler"`, `verbatimModuleSyntax: true`. Verbatim.
- **Business logic ONLY in `packages/core/src/services/<name>-service.ts`.** Each service is a plain object literal whose methods take `(db: Db, ...)` as the first argument. Routes contain zero business rules — they parse, call a service, and serialize. Verbatim.
- **No wall-clock dependence in logic.** Every method that needs "now" takes an injectable `now: Date` as its LAST parameter, defaulting to `new Date()`. Tests ALWAYS pass a fixed `now` so results are deterministic. Verbatim.
- **Single running timer, system-wide.** At most one `timeEntries` row may have `endedAt IS NULL` at any time. `startTimer` enforces this by **auto-stopping the previously running entry** (using the same `now`) before opening a new one. This is the chosen policy — it never throws `ConflictError` for a running timer; it silently closes the old one. Document this in code comments and the DoD. Verbatim.
- **Duration is computed, never trusted from the client on stop.** On `stopTimer`, `durationSeconds = round((now - startedAt) / 1000)`. For `logManual`, exactly one of `endedAt` / `durationSeconds` is supplied and the other is derived. Verbatim.
- **Reports count only closed entries.** `reportService.timeReport` includes only rows where `durationSeconds IS NOT NULL` (i.e. `endedAt` is set). A currently-running timer contributes nothing until stopped — this keeps reports independent of the wall clock. Verbatim.
- **Day bucketing is UTC.** `groupBy: 'day'` keys buckets by `startedAt.toISOString().slice(0, 10)` (`YYYY-MM-DD`, UTC). Documented so tests use UTC-midnight-safe timestamps. Verbatim.
- **Tag bucketing double-counts by design.** A time entry whose task carries N tags contributes its full duration to each of the N tag buckets, so the sum of tag-bucket totals can exceed the grand total. Tasks with no tags fall in a synthetic `untagged` bucket. Document this. Verbatim.
- **Errors:** consume `NotFoundError`, `ValidationError`, `ConflictError` from `packages/core/src/errors.ts` (created in Phase 1). Services throw these; the Phase 1 API error middleware maps `NotFoundError→404`, `ValidationError→400`, `ConflictError→409`. Do not re-create the error classes.
- **API context:** Phase 1 exposes the request-scoped `Db` on the Hono context as `c.get('db')` (typed via `AppEnv = { Variables: { db: Db } }` in `apps/api/src/types.ts`), populated by a middleware that reads the `JUSTDOIT_DB` env var. Phase 1's `createApp(db: Db)` factory (`apps/api/src/app.ts`) mounts route modules and installs the error middleware; you ADD `app.route('/', ...)` mounts for the new modules.
- **REST query params are snake_case** (`task_id`, `project_id`, `group_by`, …); request/response JSON bodies use the core camelCase field names. Zod query schemas map snake→camel via `.transform(...)`. `Date` fields serialize to ISO-8601 strings through `c.json`.
- Time-entry source enum: `timer | manual` (`TIME_ENTRY_SOURCES`). Verbatim.

---

## File Structure

```
packages/core/
├── src/
│   ├── schemas/
│   │   ├── time-entry-schema.ts     # NEW: logManual / updateEntry / list-filter schemas + types
│   │   └── report-schema.ts         # NEW: time-report query schema (+ snake-case params schema)
│   ├── services/
│   │   ├── time-service.ts          # NEW: startTimer/stopTimer/logManual/listEntries/updateEntry/deleteEntry/getRunning
│   │   ├── time-service.test.ts     # NEW
│   │   ├── report-service.ts        # NEW: timeReport (+ report result types)
│   │   └── report-service.test.ts   # NEW
│   ├── schemas/time-entry-schema.test.ts  # NEW (schema unit tests)
│   └── index.ts                     # MODIFY: re-export new schemas + services
apps/api/
└── src/
    ├── app.ts                       # MODIFY: mount timeRoutes + reportRoutes
    └── routes/
        ├── time-entries.ts          # NEW: timer start/stop + /time-entries CRUD
        ├── time-entries.test.ts     # NEW
        ├── reports.ts               # NEW: GET /reports/time
        └── reports.test.ts          # NEW
```

---

## Task 1: Zod schemas for time entries & reports

**Files:**

- Create: `packages/core/src/schemas/time-entry-schema.ts`
- Create: `packages/core/src/schemas/report-schema.ts`
- Create: `packages/core/src/schemas/time-entry-schema.test.ts`
- Modify: `packages/core/src/index.ts` (re-export the two schema modules)

**Interfaces:**

- Consumes: `TIME_ENTRY_SOURCES` from `../db/schema`; Zod.
- Produces:
  - `logManualSchema` → `LogManualInput = { taskId: string; startedAt: Date; endedAt?: Date; durationSeconds?: number; note?: string }`. Refinements: exactly one of `endedAt`/`durationSeconds` present; `endedAt >= startedAt` when given.
  - `updateEntrySchema` → `UpdateEntryInput = { startedAt?: Date; endedAt?: Date | null; durationSeconds?: number | null; note?: string | null; source?: TimeEntrySource }` with an "at least one field" refinement.
  - `timeEntryFilterSchema` (snake→camel query transform) → `TimeEntryFilter = { taskId?: string; projectId?: string; from?: Date; to?: Date; source?: TimeEntrySource; running?: boolean; limit?: number; offset?: number }`.
  - `timeReportQuerySchema` → `TimeReportQuery = { groupBy: 'day'|'project'|'tag'; from?: Date; to?: Date }`.
  - `timeReportQueryParamsSchema` (snake→camel: `group_by`) → `TimeReportQuery`.

- [ ] **Step 1: Write the failing schema test — `packages/core/src/schemas/time-entry-schema.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { logManualSchema, updateEntrySchema, timeEntryFilterSchema } from './time-entry-schema';

describe('logManualSchema', () => {
  it('accepts an explicit endedAt and coerces ISO strings to Date', () => {
    const parsed = logManualSchema.parse({
      taskId: '11111111-1111-4111-8111-111111111111',
      startedAt: '2026-07-08T09:00:00.000Z',
      endedAt: '2026-07-08T10:00:00.000Z',
    });
    expect(parsed.startedAt).toBeInstanceOf(Date);
    expect(parsed.endedAt).toBeInstanceOf(Date);
  });

  it('accepts an explicit durationSeconds', () => {
    const parsed = logManualSchema.parse({
      taskId: '11111111-1111-4111-8111-111111111111',
      startedAt: '2026-07-08T09:00:00.000Z',
      durationSeconds: 1800,
    });
    expect(parsed.durationSeconds).toBe(1800);
  });

  it('rejects when neither endedAt nor durationSeconds is present', () => {
    expect(() =>
      logManualSchema.parse({
        taskId: '11111111-1111-4111-8111-111111111111',
        startedAt: '2026-07-08T09:00:00.000Z',
      }),
    ).toThrow();
  });

  it('rejects when BOTH endedAt and durationSeconds are present', () => {
    expect(() =>
      logManualSchema.parse({
        taskId: '11111111-1111-4111-8111-111111111111',
        startedAt: '2026-07-08T09:00:00.000Z',
        endedAt: '2026-07-08T10:00:00.000Z',
        durationSeconds: 1800,
      }),
    ).toThrow();
  });

  it('rejects endedAt earlier than startedAt', () => {
    expect(() =>
      logManualSchema.parse({
        taskId: '11111111-1111-4111-8111-111111111111',
        startedAt: '2026-07-08T10:00:00.000Z',
        endedAt: '2026-07-08T09:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('updateEntrySchema', () => {
  it('allows a partial patch', () => {
    expect(updateEntrySchema.parse({ note: 'refactor' })).toEqual({ note: 'refactor' });
  });

  it('allows nulling a field', () => {
    expect(updateEntrySchema.parse({ note: null })).toEqual({ note: null });
  });

  it('rejects an empty patch', () => {
    expect(() => updateEntrySchema.parse({})).toThrow();
  });
});

describe('timeEntryFilterSchema', () => {
  it('maps snake_case query params to a camelCase filter', () => {
    const parsed = timeEntryFilterSchema.parse({
      task_id: '11111111-1111-4111-8111-111111111111',
      project_id: '22222222-2222-4222-8222-222222222222',
      running: 'true',
      limit: '25',
    });
    expect(parsed).toMatchObject({
      taskId: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      running: true,
      limit: 25,
    });
  });

  it('parses running=false correctly (not a truthy string coercion)', () => {
    expect(timeEntryFilterSchema.parse({ running: 'false' }).running).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/core test`
Expected: FAIL — cannot resolve `./time-entry-schema` (module does not exist yet).

- [ ] **Step 3: Write `packages/core/src/schemas/time-entry-schema.ts`**

```ts
import { z } from 'zod';
import { TIME_ENTRY_SOURCES } from '../db/schema';

/** Body schema for POST /time-entries (manual log). */
export const logManualSchema = z
  .object({
    taskId: z.string().uuid(),
    startedAt: z.coerce.date(),
    endedAt: z.coerce.date().optional(),
    durationSeconds: z.number().int().nonnegative().optional(),
    note: z.string().max(2000).optional(),
  })
  .refine((v) => v.endedAt !== undefined || v.durationSeconds !== undefined, {
    message: 'Provide either endedAt or durationSeconds',
    path: ['endedAt'],
  })
  .refine((v) => !(v.endedAt !== undefined && v.durationSeconds !== undefined), {
    message: 'Provide only one of endedAt or durationSeconds',
    path: ['durationSeconds'],
  })
  .refine((v) => v.endedAt === undefined || v.endedAt.getTime() >= v.startedAt.getTime(), {
    message: 'endedAt must be at or after startedAt',
    path: ['endedAt'],
  });
export type LogManualInput = z.infer<typeof logManualSchema>;

/** Body schema for PATCH /time-entries/:id. Every field optional; null clears. */
export const updateEntrySchema = z
  .object({
    startedAt: z.coerce.date().optional(),
    endedAt: z.coerce.date().nullable().optional(),
    durationSeconds: z.number().int().nonnegative().nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    source: z.enum(TIME_ENTRY_SOURCES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateEntryInput = z.infer<typeof updateEntrySchema>;

/** Query schema for GET /time-entries — snake_case params → camelCase filter. */
export const timeEntryFilterSchema = z
  .object({
    task_id: z.string().uuid().optional(),
    project_id: z.string().uuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    source: z.enum(TIME_ENTRY_SOURCES).optional(),
    running: z.enum(['true', 'false']).optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
  })
  .transform((v) => ({
    taskId: v.task_id,
    projectId: v.project_id,
    from: v.from,
    to: v.to,
    source: v.source,
    running: v.running === undefined ? undefined : v.running === 'true',
    limit: v.limit,
    offset: v.offset,
  }));
export type TimeEntryFilter = z.infer<typeof timeEntryFilterSchema>;
```

- [ ] **Step 4: Write `packages/core/src/schemas/report-schema.ts`**

```ts
import { z } from 'zod';

export const TIME_REPORT_GROUP_BY = ['day', 'project', 'tag'] as const;
export type TimeReportGroupBy = (typeof TIME_REPORT_GROUP_BY)[number];

/** Canonical (camelCase) report query used by reportService.timeReport. */
export const timeReportQuerySchema = z.object({
  groupBy: z.enum(TIME_REPORT_GROUP_BY),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type TimeReportQuery = z.infer<typeof timeReportQuerySchema>;

/** Query schema for GET /reports/time — snake_case `group_by` → camelCase. */
export const timeReportQueryParamsSchema = z
  .object({
    group_by: z.enum(TIME_REPORT_GROUP_BY),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .transform((v): TimeReportQuery => ({ groupBy: v.group_by, from: v.from, to: v.to }));
```

- [ ] **Step 5: Re-export from the package entry — modify `packages/core/src/index.ts`**

Add these lines (keep existing exports):

```ts
export * from './schemas/time-entry-schema';
export * from './schemas/report-schema';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/core test`
Expected: PASS — all `time-entry-schema` tests green.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @justdoit/core typecheck`
Expected: PASS — no type errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): add zod schemas for time entries and time reports"
```

---

## Task 2: `timeService` — timers (start/stop/getRunning)

**Files:**

- Create: `packages/core/src/services/time-service.ts`
- Create: `packages/core/src/services/time-service.test.ts`
- Modify: `packages/core/src/index.ts` (re-export the service)

**Interfaces:**

- Consumes: `Db` from `../db/client`; `tasks`, `timeEntries`, `TimeEntry` from `../db/schema`; `NotFoundError`, `ValidationError` from `../errors`.
- Produces (this task implements 3 of the 7 methods; the object is completed in Task 3):
  - `timeService.getRunning(db: Db): TimeEntry | null` — the single row with `endedAt IS NULL` (latest `startedAt`), or `null`.
  - `timeService.startTimer(db: Db, taskId: string, now?: Date): TimeEntry` — validates the task exists; **auto-stops** any running entry with the same `now`; inserts a new `source: 'timer'` entry with `startedAt = now`, `endedAt = null`, `durationSeconds = null`.
  - `timeService.stopTimer(db: Db, ref?: { entryId?: string; taskId?: string }, now?: Date): TimeEntry` — resolves the target entry (by `entryId`, else the running entry for `taskId`, else the single system-wide running entry); errors if none found or already stopped; sets `endedAt = now` and `durationSeconds = round((now - startedAt)/1000)`.

- [ ] **Step 1: Write the failing test — `packages/core/src/services/time-service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db/client';
import { tasks } from '../db/schema';
import { timeService } from './time-service';
import { NotFoundError, ValidationError } from '../errors';

const T0 = new Date('2026-07-08T09:00:00.000Z');
const T30 = new Date('2026-07-08T09:30:00.000Z');
const T60 = new Date('2026-07-08T10:00:00.000Z');

function seedTask(db: Db, title = 'Task A'): string {
  const [t] = db.insert(tasks).values({ title }).returning().all();
  return t!.id;
}

describe('timeService timers', () => {
  let db: Db;
  beforeEach(() => {
    ({ db } = createDb(':memory:'));
    runMigrations(db);
  });

  it('startTimer opens a running entry for the task', () => {
    const taskId = seedTask(db);
    const entry = timeService.startTimer(db, taskId, T0);
    expect(entry.taskId).toBe(taskId);
    expect(entry.source).toBe('timer');
    expect(entry.startedAt.getTime()).toBe(T0.getTime());
    expect(entry.endedAt).toBeNull();
    expect(entry.durationSeconds).toBeNull();
    expect(timeService.getRunning(db)?.id).toBe(entry.id);
  });

  it('startTimer throws NotFoundError for a missing task', () => {
    expect(() => timeService.startTimer(db, 'nope', T0)).toThrow(NotFoundError);
  });

  it('startTimer auto-stops the previously running timer with the same now', () => {
    const a = seedTask(db, 'A');
    const b = seedTask(db, 'B');
    const first = timeService.startTimer(db, a, T0);
    const second = timeService.startTimer(db, b, T30);

    // Only one running timer, and it is the new one.
    const running = timeService.getRunning(db);
    expect(running?.id).toBe(second.id);

    // The first was closed at T30 (the new timer's now) → 1800s.
    const entries = timeService.listEntries?.(db) ?? [];
    const closedFirst = entries.find((e) => e.id === first.id) ?? null;
    // listEntries lands in Task 3; fall back to a direct stop check if unavailable.
    if (closedFirst) {
      expect(closedFirst.endedAt?.getTime()).toBe(T30.getTime());
      expect(closedFirst.durationSeconds).toBe(1800);
    }
  });

  it('stopTimer with no ref stops the single running entry and computes duration', () => {
    const taskId = seedTask(db);
    timeService.startTimer(db, taskId, T0);
    const stopped = timeService.stopTimer(db, {}, T60);
    expect(stopped.endedAt?.getTime()).toBe(T60.getTime());
    expect(stopped.durationSeconds).toBe(3600);
    expect(timeService.getRunning(db)).toBeNull();
  });

  it('stopTimer by taskId stops that task’s running entry', () => {
    const taskId = seedTask(db);
    timeService.startTimer(db, taskId, T0);
    const stopped = timeService.stopTimer(db, { taskId }, T30);
    expect(stopped.durationSeconds).toBe(1800);
  });

  it('stopTimer throws NotFoundError when nothing is running', () => {
    expect(() => timeService.stopTimer(db, {}, T60)).toThrow(NotFoundError);
  });

  it('stopTimer throws ValidationError when now precedes startedAt', () => {
    const taskId = seedTask(db);
    timeService.startTimer(db, taskId, T60);
    expect(() => timeService.stopTimer(db, {}, T0)).toThrow(ValidationError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/core test time-service`
Expected: FAIL — cannot resolve `./time-service`.

- [ ] **Step 3: Write `packages/core/src/services/time-service.ts` (timer methods; management methods added in Task 3)**

```ts
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { tasks, timeEntries, type TimeEntry } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';

function requireTask(db: Db, taskId: string): void {
  const [task] = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).all();
  if (!task) throw new NotFoundError(`Task ${taskId} not found`);
}

export const timeService = {
  /** The single system-wide running entry (endedAt IS NULL), or null. */
  getRunning(db: Db): TimeEntry | null {
    const [entry] = db
      .select()
      .from(timeEntries)
      .where(isNull(timeEntries.endedAt))
      .orderBy(desc(timeEntries.startedAt))
      .limit(1)
      .all();
    return entry ?? null;
  },

  /**
   * Start a timer for a task. Enforces the single-running-timer invariant by
   * auto-stopping any currently running entry (with the same `now`) first.
   */
  startTimer(db: Db, taskId: string, now: Date = new Date()): TimeEntry {
    requireTask(db, taskId);
    const running = this.getRunning(db);
    if (running) {
      this.stopTimer(db, { entryId: running.id }, now);
    }
    const [entry] = db
      .insert(timeEntries)
      .values({
        taskId,
        startedAt: now,
        endedAt: null,
        durationSeconds: null,
        source: 'timer',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all();
    return entry!;
  },

  /**
   * Stop a timer. Target resolution order: explicit entryId, else the running
   * entry for taskId, else the single system-wide running entry.
   */
  stopTimer(
    db: Db,
    ref: { entryId?: string; taskId?: string } = {},
    now: Date = new Date(),
  ): TimeEntry {
    let entry: TimeEntry | undefined;
    if (ref.entryId) {
      [entry] = db.select().from(timeEntries).where(eq(timeEntries.id, ref.entryId)).all();
      if (!entry) throw new NotFoundError(`Time entry ${ref.entryId} not found`);
    } else if (ref.taskId) {
      [entry] = db
        .select()
        .from(timeEntries)
        .where(and(eq(timeEntries.taskId, ref.taskId), isNull(timeEntries.endedAt)))
        .orderBy(desc(timeEntries.startedAt))
        .limit(1)
        .all();
      if (!entry) throw new NotFoundError(`No running timer for task ${ref.taskId}`);
    } else {
      entry = this.getRunning(db) ?? undefined;
      if (!entry) throw new NotFoundError('No running timer to stop');
    }

    if (entry.endedAt) throw new ValidationError('Time entry is already stopped');
    if (now.getTime() < entry.startedAt.getTime()) {
      throw new ValidationError('Stop time must be at or after start time');
    }

    const durationSeconds = Math.round((now.getTime() - entry.startedAt.getTime()) / 1000);
    const [updated] = db
      .update(timeEntries)
      .set({ endedAt: now, durationSeconds, updatedAt: now })
      .where(eq(timeEntries.id, entry.id))
      .returning()
      .all();
    return updated!;
  },
};
```

- [ ] **Step 4: Re-export from the package entry — modify `packages/core/src/index.ts`**

Add (keep existing exports):

```ts
export * from './services/time-service';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/core test time-service`
Expected: PASS — timer tests green (the `listEntries?.` guard in the auto-stop test tolerates the method not existing yet).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @justdoit/core typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): add timeService start/stop timers with single-running guarantee"
```

---

## Task 3: `timeService` — manual entries & management (logManual/listEntries/updateEntry/deleteEntry)

**Files:**

- Modify: `packages/core/src/services/time-service.ts` (add 4 methods)
- Modify: `packages/core/src/services/time-service.test.ts` (add describe block)

**Interfaces:**

- Consumes: `Db`; `tasks`, `timeEntries`, `TimeEntry`; `NotFoundError`, `ValidationError`; `LogManualInput`, `UpdateEntryInput`, `TimeEntryFilter` from `../schemas/time-entry-schema`.
- Produces (completes the `timeService` object):
  - `logManual(db: Db, input: LogManualInput, now?: Date): TimeEntry` — validates task exists; derives the missing side of `endedAt`/`durationSeconds`; inserts `source: 'manual'`.
  - `listEntries(db: Db, filter?: TimeEntryFilter): TimeEntry[]` — filters by `taskId`, `projectId` (join to `tasks`), `from`/`to` (on `startedAt`), `source`, `running` (endedAt null/not-null); ordered `startedAt DESC`; `limit` default 100, `offset` default 0.
  - `updateEntry(db: Db, id: string, patch: UpdateEntryInput, now?: Date): TimeEntry` — patches fields; recomputes `durationSeconds` when timestamps change (or derives `endedAt` when only `durationSeconds` set on an open entry); validates `endedAt >= startedAt`.
  - `deleteEntry(db: Db, id: string): void` — hard delete; `NotFoundError` if the row does not exist.

- [ ] **Step 1: Add failing tests — append to `packages/core/src/services/time-service.test.ts`**

```ts
import { timeService as svc } from './time-service';
import { projects } from '../db/schema';

describe('timeService manual entries & management', () => {
  let db: Db;
  beforeEach(() => {
    ({ db } = createDb(':memory:'));
    runMigrations(db);
  });

  it('logManual derives durationSeconds from endedAt', () => {
    const taskId = seedTask(db);
    const e = svc.logManual(db, { taskId, startedAt: T0, endedAt: T60 }, T0);
    expect(e.source).toBe('manual');
    expect(e.durationSeconds).toBe(3600);
    expect(e.endedAt?.getTime()).toBe(T60.getTime());
  });

  it('logManual derives endedAt from durationSeconds', () => {
    const taskId = seedTask(db);
    const e = svc.logManual(db, { taskId, startedAt: T0, durationSeconds: 1800 }, T0);
    expect(e.endedAt?.getTime()).toBe(T30.getTime());
    expect(e.durationSeconds).toBe(1800);
  });

  it('logManual throws NotFoundError for a missing task', () => {
    expect(() =>
      svc.logManual(db, { taskId: 'missing', startedAt: T0, durationSeconds: 60 }, T0),
    ).toThrow(NotFoundError);
  });

  it('listEntries filters by taskId and by project', () => {
    const [proj] = db.insert(projects).values({ name: 'Work' }).returning().all();
    const a = db.insert(tasks).values({ title: 'A', projectId: proj!.id }).returning().all()[0]!;
    const b = seedTask(db, 'B'); // no project
    svc.logManual(db, { taskId: a.id, startedAt: T0, durationSeconds: 600 }, T0);
    svc.logManual(db, { taskId: b, startedAt: T0, durationSeconds: 600 }, T0);

    expect(svc.listEntries(db, { taskId: a.id })).toHaveLength(1);
    expect(svc.listEntries(db, { projectId: proj!.id })).toHaveLength(1);
    expect(svc.listEntries(db)).toHaveLength(2);
  });

  it('listEntries filters by running state', () => {
    const taskId = seedTask(db);
    svc.startTimer(db, taskId, T0); // running
    svc.logManual(db, { taskId, startedAt: T0, durationSeconds: 60 }, T0); // closed
    expect(svc.listEntries(db, { running: true })).toHaveLength(1);
    expect(svc.listEntries(db, { running: false })).toHaveLength(1);
  });

  it('updateEntry recomputes duration when endedAt changes', () => {
    const taskId = seedTask(db);
    const e = svc.logManual(db, { taskId, startedAt: T0, durationSeconds: 600 }, T0);
    const updated = svc.updateEntry(db, e.id, { endedAt: T60 }, T60);
    expect(updated.durationSeconds).toBe(3600);
  });

  it('updateEntry can set a note without touching duration', () => {
    const taskId = seedTask(db);
    const e = svc.logManual(db, { taskId, startedAt: T0, durationSeconds: 600 }, T0);
    const updated = svc.updateEntry(db, e.id, { note: 'pairing' }, T60);
    expect(updated.note).toBe('pairing');
    expect(updated.durationSeconds).toBe(600);
  });

  it('updateEntry throws NotFoundError for a missing entry', () => {
    expect(() => svc.updateEntry(db, 'nope', { note: 'x' }, T0)).toThrow(NotFoundError);
  });

  it('deleteEntry removes the row; second delete throws NotFoundError', () => {
    const taskId = seedTask(db);
    const e = svc.logManual(db, { taskId, startedAt: T0, durationSeconds: 60 }, T0);
    svc.deleteEntry(db, e.id);
    expect(svc.listEntries(db)).toHaveLength(0);
    expect(() => svc.deleteEntry(db, e.id)).toThrow(NotFoundError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/core test time-service`
Expected: FAIL — `svc.logManual is not a function` (methods not implemented yet).

- [ ] **Step 3: Add the methods — modify `packages/core/src/services/time-service.ts`**

Update the imports at the top of the file:

```ts
import { and, desc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { tasks, timeEntries, type TimeEntry } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';
import type {
  LogManualInput,
  TimeEntryFilter,
  UpdateEntryInput,
} from '../schemas/time-entry-schema';
```

Add these methods inside the `timeService` object (after `stopTimer`):

```ts
  /** Record a completed time entry with an explicit end or explicit duration. */
  logManual(db: Db, input: LogManualInput, now: Date = new Date()): TimeEntry {
    requireTask(db, input.taskId);

    let endedAt: Date;
    let durationSeconds: number;
    if (input.endedAt !== undefined) {
      endedAt = input.endedAt;
      durationSeconds = Math.round((endedAt.getTime() - input.startedAt.getTime()) / 1000);
    } else if (input.durationSeconds !== undefined) {
      durationSeconds = input.durationSeconds;
      endedAt = new Date(input.startedAt.getTime() + durationSeconds * 1000);
    } else {
      throw new ValidationError('Provide either endedAt or durationSeconds');
    }
    if (durationSeconds < 0) throw new ValidationError('Duration must be non-negative');

    const [entry] = db
      .insert(timeEntries)
      .values({
        taskId: input.taskId,
        startedAt: input.startedAt,
        endedAt,
        durationSeconds,
        note: input.note ?? null,
        source: 'manual',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all();
    return entry!;
  },

  /** List entries with optional filters; newest first. */
  listEntries(db: Db, filter: TimeEntryFilter = {}): TimeEntry[] {
    const conds = [];
    if (filter.taskId) conds.push(eq(timeEntries.taskId, filter.taskId));
    if (filter.source) conds.push(eq(timeEntries.source, filter.source));
    if (filter.from) conds.push(gte(timeEntries.startedAt, filter.from));
    if (filter.to) conds.push(lte(timeEntries.startedAt, filter.to));
    if (filter.running === true) conds.push(isNull(timeEntries.endedAt));
    if (filter.running === false) conds.push(isNotNull(timeEntries.endedAt));
    const base = conds.length ? and(...conds) : undefined;
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    if (filter.projectId) {
      const where = base
        ? and(base, eq(tasks.projectId, filter.projectId))
        : eq(tasks.projectId, filter.projectId);
      return db
        .select({ entry: timeEntries })
        .from(timeEntries)
        .innerJoin(tasks, eq(timeEntries.taskId, tasks.id))
        .where(where)
        .orderBy(desc(timeEntries.startedAt))
        .limit(limit)
        .offset(offset)
        .all()
        .map((r) => r.entry);
    }

    return db
      .select()
      .from(timeEntries)
      .where(base)
      .orderBy(desc(timeEntries.startedAt))
      .limit(limit)
      .offset(offset)
      .all();
  },

  /** Patch a time entry, recomputing duration when timestamps change. */
  updateEntry(db: Db, id: string, patch: UpdateEntryInput, now: Date = new Date()): TimeEntry {
    const [existing] = db.select().from(timeEntries).where(eq(timeEntries.id, id)).all();
    if (!existing) throw new NotFoundError(`Time entry ${id} not found`);

    const startedAt = patch.startedAt ?? existing.startedAt;
    let endedAt = patch.endedAt !== undefined ? patch.endedAt : existing.endedAt;
    let durationSeconds =
      patch.durationSeconds !== undefined ? patch.durationSeconds : existing.durationSeconds;

    if (endedAt) {
      // A concrete end time is authoritative: derive duration from timestamps.
      durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
    } else if (patch.durationSeconds != null) {
      // Open entry with an explicit duration → derive the end time.
      endedAt = new Date(startedAt.getTime() + patch.durationSeconds * 1000);
      durationSeconds = patch.durationSeconds;
    }

    if (endedAt && endedAt.getTime() < startedAt.getTime()) {
      throw new ValidationError('endedAt must be at or after startedAt');
    }

    const [updated] = db
      .update(timeEntries)
      .set({
        startedAt,
        endedAt,
        durationSeconds,
        note: patch.note !== undefined ? patch.note : existing.note,
        source: patch.source ?? existing.source,
        updatedAt: now,
      })
      .where(eq(timeEntries.id, id))
      .returning()
      .all();
    return updated!;
  },

  /** Hard-delete a time entry. */
  deleteEntry(db: Db, id: string): void {
    const res = db.delete(timeEntries).where(eq(timeEntries.id, id)).run();
    if (res.changes === 0) throw new NotFoundError(`Time entry ${id} not found`);
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/core test time-service`
Expected: PASS — timer + management suites green (including the previously-guarded auto-stop assertion, which now exercises `listEntries`).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @justdoit/core typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): add timeService manual entries, listing, update, delete"
```

---

## Task 4: `reportService` — time report (totals + estimate vs actual)

**Files:**

- Create: `packages/core/src/services/report-service.ts`
- Create: `packages/core/src/services/report-service.test.ts`
- Modify: `packages/core/src/index.ts` (re-export the service + result types)

**Interfaces:**

- Consumes: `Db`; `tasks`, `projects`, `tags`, `taskTags`, `timeEntries` from `../db/schema`; `TimeReportQuery` from `../schemas/report-schema`.
- Produces:
  - `reportService.timeReport(db: Db, query: TimeReportQuery): TimeReport`.
  - Types:
    - `TimeReportBucket = { key: string; label: string; totalSeconds: number; entryCount: number }`.
    - `EstimateVsActual = { taskId: string; title: string; estimateMinutes: number | null; actualSeconds: number; actualMinutes: number; varianceMinutes: number | null }`.
    - `TimeReport = { groupBy: 'day'|'project'|'tag'; from: Date | null; to: Date | null; totalSeconds: number; buckets: TimeReportBucket[]; estimateVsActual: EstimateVsActual[] }`.
  - Semantics: only closed entries (`durationSeconds IS NOT NULL`) within `[from, to]` on `startedAt`; day buckets keyed by UTC `YYYY-MM-DD`; project buckets keyed by `projectId` (nulls → synthetic `inbox`/`Inbox`); tag buckets double-count multi-tag tasks and use a synthetic `untagged` bucket for tagless tasks. `varianceMinutes = actualMinutes - estimateMinutes` (or `null` when no estimate). Day buckets sort ascending by key; project/tag buckets sort by `totalSeconds` desc; `estimateVsActual` sorts by `title`.

- [ ] **Step 1: Write the failing test — `packages/core/src/services/report-service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db/client';
import { projects, tags, taskTags, tasks } from '../db/schema';
import { timeService } from './time-service';
import { reportService } from './report-service';

const D1_0900 = new Date('2026-07-08T09:00:00.000Z');
const D1_1000 = new Date('2026-07-08T10:00:00.000Z');
const D2_0900 = new Date('2026-07-09T09:00:00.000Z');

describe('reportService.timeReport', () => {
  let db: Db;
  beforeEach(() => {
    ({ db } = createDb(':memory:'));
    runMigrations(db);
  });

  it('groups by UTC day and sums only closed entries', () => {
    const [t] = db.insert(tasks).values({ title: 'A', estimateMinutes: 30 }).returning().all();
    timeService.logManual(
      db,
      { taskId: t!.id, startedAt: D1_0900, durationSeconds: 3600 },
      D1_0900,
    );
    timeService.logManual(
      db,
      { taskId: t!.id, startedAt: D2_0900, durationSeconds: 1800 },
      D2_0900,
    );
    // A running timer must NOT be counted.
    timeService.startTimer(db, t!.id, D2_0900);

    const report = reportService.timeReport(db, { groupBy: 'day' });
    expect(report.totalSeconds).toBe(5400);
    expect(report.buckets).toEqual([
      { key: '2026-07-08', label: '2026-07-08', totalSeconds: 3600, entryCount: 1 },
      { key: '2026-07-09', label: '2026-07-09', totalSeconds: 1800, entryCount: 1 },
    ]);
  });

  it('respects the from/to window on startedAt', () => {
    const [t] = db.insert(tasks).values({ title: 'A' }).returning().all();
    timeService.logManual(
      db,
      { taskId: t!.id, startedAt: D1_0900, durationSeconds: 3600 },
      D1_0900,
    );
    timeService.logManual(
      db,
      { taskId: t!.id, startedAt: D2_0900, durationSeconds: 1800 },
      D2_0900,
    );
    const report = reportService.timeReport(db, {
      groupBy: 'day',
      from: new Date('2026-07-09T00:00:00.000Z'),
    });
    expect(report.totalSeconds).toBe(1800);
  });

  it('groups by project, mapping null project to Inbox', () => {
    const [proj] = db.insert(projects).values({ name: 'Work' }).returning().all();
    const withProj = db
      .insert(tasks)
      .values({ title: 'A', projectId: proj!.id })
      .returning()
      .all()[0]!;
    const noProj = db.insert(tasks).values({ title: 'B' }).returning().all()[0]!;
    timeService.logManual(
      db,
      { taskId: withProj.id, startedAt: D1_0900, durationSeconds: 3600 },
      D1_0900,
    );
    timeService.logManual(
      db,
      { taskId: noProj.id, startedAt: D1_0900, durationSeconds: 600 },
      D1_0900,
    );

    const report = reportService.timeReport(db, { groupBy: 'project' });
    expect(report.buckets[0]).toEqual({
      key: proj!.id,
      label: 'Work',
      totalSeconds: 3600,
      entryCount: 1,
    });
    expect(report.buckets.find((b) => b.key === 'inbox')?.label).toBe('Inbox');
  });

  it('groups by tag, double-counting multi-tag tasks', () => {
    const [t] = db.insert(tasks).values({ title: 'A' }).returning().all();
    const [red] = db.insert(tags).values({ name: 'red' }).returning().all();
    const [blue] = db.insert(tags).values({ name: 'blue' }).returning().all();
    db.insert(taskTags).values({ taskId: t!.id, tagId: red!.id }).run();
    db.insert(taskTags).values({ taskId: t!.id, tagId: blue!.id }).run();
    timeService.logManual(
      db,
      { taskId: t!.id, startedAt: D1_0900, durationSeconds: 3600 },
      D1_0900,
    );

    const report = reportService.timeReport(db, { groupBy: 'tag' });
    expect(report.totalSeconds).toBe(3600); // grand total counts the entry once
    const byKey = Object.fromEntries(report.buckets.map((b) => [b.label, b.totalSeconds]));
    expect(byKey).toEqual({ red: 3600, blue: 3600 }); // each tag bucket gets the full duration
  });

  it('computes estimate vs actual with variance', () => {
    const [t] = db.insert(tasks).values({ title: 'A', estimateMinutes: 30 }).returning().all();
    timeService.logManual(db, { taskId: t!.id, startedAt: D1_0900, endedAt: D1_1000 }, D1_0900);
    const report = reportService.timeReport(db, { groupBy: 'day' });
    expect(report.estimateVsActual).toEqual([
      {
        taskId: t!.id,
        title: 'A',
        estimateMinutes: 30,
        actualSeconds: 3600,
        actualMinutes: 60,
        varianceMinutes: 30,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/core test report-service`
Expected: FAIL — cannot resolve `./report-service`.

- [ ] **Step 3: Write `packages/core/src/services/report-service.ts`**

```ts
import { and, eq, gte, isNotNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client';
import { projects, tags, taskTags, tasks, timeEntries } from '../db/schema';
import type { TimeReportGroupBy, TimeReportQuery } from '../schemas/report-schema';

export interface TimeReportBucket {
  key: string;
  label: string;
  totalSeconds: number;
  entryCount: number;
}

export interface EstimateVsActual {
  taskId: string;
  title: string;
  estimateMinutes: number | null;
  actualSeconds: number;
  actualMinutes: number;
  varianceMinutes: number | null;
}

export interface TimeReport {
  groupBy: TimeReportGroupBy;
  from: Date | null;
  to: Date | null;
  totalSeconds: number;
  buckets: TimeReportBucket[];
  estimateVsActual: EstimateVsActual[];
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const reportService = {
  timeReport(db: Db, query: TimeReportQuery): TimeReport {
    const conds = [isNotNull(timeEntries.durationSeconds)];
    if (query.from) conds.push(gte(timeEntries.startedAt, query.from));
    if (query.to) conds.push(lte(timeEntries.startedAt, query.to));

    const rows = db
      .select({
        taskId: timeEntries.taskId,
        startedAt: timeEntries.startedAt,
        durationSeconds: timeEntries.durationSeconds,
        projectId: tasks.projectId,
        title: tasks.title,
        estimateMinutes: tasks.estimateMinutes,
      })
      .from(timeEntries)
      .innerJoin(tasks, eq(timeEntries.taskId, tasks.id))
      .where(and(...conds))
      .all();

    // Lookups needed only for specific groupings.
    const projectNames = new Map<string, string>();
    if (query.groupBy === 'project') {
      for (const p of db.select({ id: projects.id, name: projects.name }).from(projects).all()) {
        projectNames.set(p.id, p.name);
      }
    }
    const tagsByTask = new Map<string, { id: string; name: string }[]>();
    if (query.groupBy === 'tag') {
      const rel = db
        .select({ taskId: taskTags.taskId, tagId: tags.id, tagName: tags.name })
        .from(taskTags)
        .innerJoin(tags, eq(taskTags.tagId, tags.id))
        .all();
      for (const r of rel) {
        const list = tagsByTask.get(r.taskId) ?? [];
        list.push({ id: r.tagId, name: r.tagName });
        tagsByTask.set(r.taskId, list);
      }
    }

    const buckets = new Map<string, TimeReportBucket>();
    const bump = (key: string, label: string, seconds: number): void => {
      const b = buckets.get(key) ?? { key, label, totalSeconds: 0, entryCount: 0 };
      b.totalSeconds += seconds;
      b.entryCount += 1;
      buckets.set(key, b);
    };

    const estMap = new Map<string, EstimateVsActual>();
    let totalSeconds = 0;

    for (const r of rows) {
      const seconds = r.durationSeconds ?? 0;
      totalSeconds += seconds;

      const eva = estMap.get(r.taskId) ?? {
        taskId: r.taskId,
        title: r.title,
        estimateMinutes: r.estimateMinutes ?? null,
        actualSeconds: 0,
        actualMinutes: 0,
        varianceMinutes: null,
      };
      eva.actualSeconds += seconds;
      estMap.set(r.taskId, eva);

      if (query.groupBy === 'day') {
        const key = utcDay(r.startedAt);
        bump(key, key, seconds);
      } else if (query.groupBy === 'project') {
        if (r.projectId) {
          bump(r.projectId, projectNames.get(r.projectId) ?? 'Unknown', seconds);
        } else {
          bump('inbox', 'Inbox', seconds);
        }
      } else {
        const taskTagList = tagsByTask.get(r.taskId) ?? [];
        if (taskTagList.length === 0) {
          bump('untagged', 'Untagged', seconds);
        } else {
          for (const t of taskTagList) bump(t.id, t.name, seconds);
        }
      }
    }

    const estimateVsActual = [...estMap.values()]
      .map((e) => {
        const actualMinutes = Math.round(e.actualSeconds / 60);
        return {
          ...e,
          actualMinutes,
          varianceMinutes: e.estimateMinutes == null ? null : actualMinutes - e.estimateMinutes,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));

    const bucketList = [...buckets.values()].sort((a, b) =>
      query.groupBy === 'day' ? a.key.localeCompare(b.key) : b.totalSeconds - a.totalSeconds,
    );

    return {
      groupBy: query.groupBy,
      from: query.from ?? null,
      to: query.to ?? null,
      totalSeconds,
      buckets: bucketList,
      estimateVsActual,
    };
  },
};
```

- [ ] **Step 4: Re-export from the package entry — modify `packages/core/src/index.ts`**

Add (keep existing exports):

```ts
export * from './services/report-service';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/core test report-service`
Expected: PASS — all report tests green.

- [ ] **Step 6: Run the full core suite + typecheck**

Run: `pnpm --filter @justdoit/core test && pnpm --filter @justdoit/core typecheck`
Expected: PASS — schema, time-service, report-service suites all green; no type errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): add reportService time report with estimate-vs-actual"
```

---

## Task 5: REST routes — timers & time-entries CRUD

**Files:**

- Create: `apps/api/src/routes/time-entries.ts`
- Create: `apps/api/src/routes/time-entries.test.ts`
- Modify: `apps/api/src/app.ts` (mount the router)

**Interfaces:**

- Consumes: `timeService`, `logManualSchema`, `updateEntrySchema`, `timeEntryFilterSchema` from `@justdoit/core`; `AppEnv` from `../types`; `createApp` from `../app`; Hono + `@hono/zod-validator`. Errors bubble to the Phase 1 error middleware.
- Produces a mounted `Hono<AppEnv>` router (`timeRoutes`) exposing:
  - `POST /tasks/:id/timer/start` → `timeService.startTimer(db, id)` → `201` with the new entry.
  - `POST /tasks/:id/timer/stop` → `timeService.stopTimer(db, { taskId: id })` → `200` with the closed entry.
  - `GET /time-entries` (`zValidator('query', timeEntryFilterSchema)`) → `timeService.listEntries(db, filter)` → `200` array.
  - `POST /time-entries` (`zValidator('json', logManualSchema)`) → `timeService.logManual(db, body)` → `201`.
  - `PATCH /time-entries/:id` (`zValidator('json', updateEntrySchema)`) → `timeService.updateEntry(db, id, patch)` → `200`.
  - `DELETE /time-entries/:id` → `timeService.deleteEntry(db, id)` → `204` no body.

- [ ] **Step 1: Write the failing test — `apps/api/src/routes/time-entries.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, tasks, type Db } from '@justdoit/core';
import { createApp } from '../app';

let db: Db;
let app: ReturnType<typeof createApp>;

function seedTask(title = 'Task A'): string {
  const [t] = db.insert(tasks).values({ title }).returning().all();
  return t!.id;
}

beforeEach(() => {
  ({ db } = createDb(':memory:'));
  runMigrations(db);
  app = createApp(db);
});

describe('timer + time-entry routes', () => {
  it('starts and stops a timer', async () => {
    const taskId = seedTask();
    const startRes = await app.request(`/tasks/${taskId}/timer/start`, { method: 'POST' });
    expect(startRes.status).toBe(201);
    const started = await startRes.json();
    expect(started.endedAt).toBeNull();

    const stopRes = await app.request(`/tasks/${taskId}/timer/stop`, { method: 'POST' });
    expect(stopRes.status).toBe(200);
    const stopped = await stopRes.json();
    expect(typeof stopped.durationSeconds).toBe('number');
    expect(stopped.endedAt).not.toBeNull();
  });

  it('returns 404 stopping a task with no running timer', async () => {
    const taskId = seedTask();
    const res = await app.request(`/tasks/${taskId}/timer/stop`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('logs a manual entry with explicit duration (201)', async () => {
    const taskId = seedTask();
    const res = await app.request('/time-entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        taskId,
        startedAt: '2026-07-08T09:00:00.000Z',
        durationSeconds: 1800,
      }),
    });
    expect(res.status).toBe(201);
    const entry = await res.json();
    expect(entry.source).toBe('manual');
    expect(entry.durationSeconds).toBe(1800);
  });

  it('rejects a manual entry with both endedAt and durationSeconds (400)', async () => {
    const taskId = seedTask();
    const res = await app.request('/time-entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        taskId,
        startedAt: '2026-07-08T09:00:00.000Z',
        endedAt: '2026-07-08T10:00:00.000Z',
        durationSeconds: 1800,
      }),
    });
    expect(res.status).toBe(400);
  });

  it('lists, filters, patches, and deletes entries', async () => {
    const taskId = seedTask();
    await app.request('/time-entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId, startedAt: '2026-07-08T09:00:00.000Z', durationSeconds: 600 }),
    });

    const listRes = await app.request(`/time-entries?task_id=${taskId}`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list).toHaveLength(1);
    const id = list[0].id;

    const patchRes = await app.request(`/time-entries/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: 'pairing' }),
    });
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).note).toBe('pairing');

    const delRes = await app.request(`/time-entries/${id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(204);
    expect(await (await app.request('/time-entries')).json()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/api test time-entries`
Expected: FAIL — router not mounted / `../routes/time-entries` does not exist (routes return 404 or import error).

- [ ] **Step 3: Write `apps/api/src/routes/time-entries.ts`**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  timeService,
  logManualSchema,
  updateEntrySchema,
  timeEntryFilterSchema,
} from '@justdoit/core';
import type { AppEnv } from '../types';

export const timeRoutes = new Hono<AppEnv>();

timeRoutes.post('/tasks/:id/timer/start', (c) => {
  const entry = timeService.startTimer(c.get('db'), c.req.param('id'));
  return c.json(entry, 201);
});

timeRoutes.post('/tasks/:id/timer/stop', (c) => {
  const entry = timeService.stopTimer(c.get('db'), { taskId: c.req.param('id') });
  return c.json(entry, 200);
});

timeRoutes.get('/time-entries', zValidator('query', timeEntryFilterSchema), (c) => {
  return c.json(timeService.listEntries(c.get('db'), c.req.valid('query')));
});

timeRoutes.post('/time-entries', zValidator('json', logManualSchema), (c) => {
  const entry = timeService.logManual(c.get('db'), c.req.valid('json'));
  return c.json(entry, 201);
});

timeRoutes.patch('/time-entries/:id', zValidator('json', updateEntrySchema), (c) => {
  const entry = timeService.updateEntry(c.get('db'), c.req.param('id'), c.req.valid('json'));
  return c.json(entry, 200);
});

timeRoutes.delete('/time-entries/:id', (c) => {
  timeService.deleteEntry(c.get('db'), c.req.param('id'));
  return c.body(null, 204);
});
```

- [ ] **Step 4: Mount the router — modify `apps/api/src/app.ts`**

Import and mount alongside the Phase 1 routers (add these two lines to `createApp`, before the `return app`):

```ts
import { timeRoutes } from './routes/time-entries';
// ...inside createApp(db):
app.route('/', timeRoutes);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/api test time-entries`
Expected: PASS — all timer/time-entry route tests green.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @justdoit/api typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): add timer and time-entry REST routes"
```

---

## Task 6: REST route — `GET /reports/time`

**Files:**

- Create: `apps/api/src/routes/reports.ts`
- Create: `apps/api/src/routes/reports.test.ts`
- Modify: `apps/api/src/app.ts` (mount the router)

**Interfaces:**

- Consumes: `reportService`, `timeReportQueryParamsSchema` from `@justdoit/core`; `AppEnv`; `createApp`; Hono + `@hono/zod-validator`.
- Produces a mounted `Hono<AppEnv>` router (`reportRoutes`) exposing:
  - `GET /reports/time?group_by=&from=&to=` (`zValidator('query', timeReportQueryParamsSchema)`) → `reportService.timeReport(db, query)` → `200` with the `TimeReport`. Missing/invalid `group_by` → `400` via the validator.

- [ ] **Step 1: Write the failing test — `apps/api/src/routes/reports.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, tasks, timeService, type Db } from '@justdoit/core';
import { createApp } from '../app';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  ({ db } = createDb(':memory:'));
  runMigrations(db);
  app = createApp(db);
});

describe('GET /reports/time', () => {
  it('returns totals grouped by day plus estimate-vs-actual', async () => {
    const [t] = db.insert(tasks).values({ title: 'A', estimateMinutes: 30 }).returning().all();
    timeService.logManual(
      db,
      { taskId: t!.id, startedAt: new Date('2026-07-08T09:00:00.000Z'), durationSeconds: 3600 },
      new Date('2026-07-08T09:00:00.000Z'),
    );

    const res = await app.request('/reports/time?group_by=day');
    expect(res.status).toBe(200);
    const report = await res.json();
    expect(report.groupBy).toBe('day');
    expect(report.totalSeconds).toBe(3600);
    expect(report.buckets[0]).toMatchObject({ key: '2026-07-08', totalSeconds: 3600 });
    expect(report.estimateVsActual[0]).toMatchObject({
      estimateMinutes: 30,
      actualMinutes: 60,
      varianceMinutes: 30,
    });
  });

  it('rejects a missing group_by with 400', async () => {
    const res = await app.request('/reports/time');
    expect(res.status).toBe(400);
  });

  it('honors the from window', async () => {
    const [t] = db.insert(tasks).values({ title: 'A' }).returning().all();
    timeService.logManual(
      db,
      { taskId: t!.id, startedAt: new Date('2026-07-08T09:00:00.000Z'), durationSeconds: 600 },
      new Date('2026-07-08T09:00:00.000Z'),
    );
    const res = await app.request('/reports/time?group_by=day&from=2026-07-09T00:00:00.000Z');
    expect((await res.json()).totalSeconds).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/api test reports`
Expected: FAIL — `../routes/reports` does not exist / route returns 404.

- [ ] **Step 3: Write `apps/api/src/routes/reports.ts`**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { reportService, timeReportQueryParamsSchema } from '@justdoit/core';
import type { AppEnv } from '../types';

export const reportRoutes = new Hono<AppEnv>();

reportRoutes.get('/reports/time', zValidator('query', timeReportQueryParamsSchema), (c) => {
  return c.json(reportService.timeReport(c.get('db'), c.req.valid('query')));
});
```

- [ ] **Step 4: Mount the router — modify `apps/api/src/app.ts`**

Add alongside the other mounts in `createApp`:

```ts
import { reportRoutes } from './routes/reports';
// ...inside createApp(db):
app.route('/', reportRoutes);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/api test reports`
Expected: PASS — report route tests green.

- [ ] **Step 6: Run every workspace gate**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: all PASS across `@justdoit/core` and `@justdoit/api`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(api): add GET /reports/time route"
```

---

## Phase 2 Definition of Done

- `@justdoit/core` exports `timeService` with `getRunning`, `startTimer`, `stopTimer`, `logManual`, `listEntries`, `updateEntry`, `deleteEntry`, and `reportService.timeReport`, plus the Zod schemas (`logManualSchema`, `updateEntrySchema`, `timeEntryFilterSchema`, `timeReportQuerySchema`, `timeReportQueryParamsSchema`) and result types (`TimeReport`, `TimeReportBucket`, `EstimateVsActual`).
- **Single running timer is guaranteed:** at most one `timeEntries` row has `endedAt IS NULL`; `startTimer` auto-stops the previous running entry with the same `now` (documented policy — never a `ConflictError`).
- **Durations are computed:** `stopTimer` and `logManual` compute/derive `durationSeconds`; the client never sets it directly on stop.
- **All service methods that need "now" accept an injectable `now: Date`**; every test passes fixed timestamps and asserts exact durations (no wall-clock reads).
- **Reports** aggregate only closed entries, group by UTC `day` / `project` (null→Inbox) / `tag` (double-counted, `untagged` bucket), and return per-task estimate-vs-actual with `varianceMinutes`.
- REST endpoints live and pass integration tests: `POST /tasks/:id/timer/start`, `POST /tasks/:id/timer/stop`, `GET /time-entries`, `POST /time-entries`, `PATCH /time-entries/:id`, `DELETE /time-entries/:id`, `GET /reports/time?group_by=&from=&to=`. Domain errors map to `404/400/409` via the Phase 1 middleware.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all pass.

## Notes for later phases

- **MCP (Phase 4):** `start_timer`, `stop_timer`, `log_time`, and `get_time_report` tools wrap `timeService.startTimer/stopTimer/logManual` and `reportService.timeReport` directly (in-process) — reuse `logManualSchema` / `timeReportQuerySchema` as the tools' input schemas. Pass an explicit `now` only for testing; production calls use the default.
- **UI (Phase 5):** the analytics dashboard consumes `GET /reports/time`; the inline task timer consumes the timer + `getRunning` surface. Consider adding a lightweight `GET /timer/running` (thin wrapper over `timeService.getRunning`) if the UI needs to restore an active timer on load — deferred until the UI phase confirms the need.
- **Running-timer live duration:** reports intentionally exclude the open entry. If a "current elapsed" figure is needed in the UI, compute it client-side from `getRunning().startedAt` rather than in `reportService` (keeps reports clock-independent).
- **Scheduling (Phase 3)** does not depend on time tracking, but a future "time budget vs due date" view could join `estimateMinutes` (already surfaced in `estimateVsActual`) with `dueAt`.
- **Timezone:** day bucketing is UTC in v1. A user-timezone-aware `group_by=day` is a candidate enhancement; the `timeReportQuerySchema` can gain an optional `tz` field without breaking callers.
