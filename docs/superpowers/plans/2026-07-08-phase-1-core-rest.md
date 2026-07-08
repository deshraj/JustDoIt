# Phase 1: Core Services + REST API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the `@justdoit/core` schema from Phase 0 into a fully test-driven domain layer (errors, Zod schemas, `projectService`, `tagService`, `taskService`, a natural-language `quickAddService`, and an `exportService`), then expose all of it through a thin Hono REST API (`@justdoit/api`) that maps core errors to HTTP status codes and reuses the exact same Zod schemas for request validation. Proven by passing Vitest suites for every service and integration tests hitting the Hono app.

**Architecture:** All business logic and validation live in `packages/core/src/services/*` and `packages/core/src/schemas/*` — each service is a plain object whose methods take `(db: Db, ...args)` as the first parameter. `apps/api` is a thin adapter: it creates one `Db` at startup from env, builds a Hono app via a `createApp(db)` factory (so tests can inject an in-memory DB), validates requests with `@hono/zod-validator` reusing core schemas, and delegates to core services. A single error-middleware translates `NotFoundError → 404`, `ValidationError → 400`, `ConflictError → 409`, `ZodError → 400`. No business rules live in the adapter.

**Tech Stack:** TypeScript 5.7 (strict), `@justdoit/core` (Drizzle + `better-sqlite3` + Zod), Hono 4, `@hono/node-server`, `@hono/zod-validator`, `tsx` (dev runner), Vitest 3.

## Global Constraints

- Node `>=22`; pnpm `10.4.1` (pin via `packageManager`). Verbatim.
- Package names are scoped `@justdoit/*`; this phase adds `@justdoit/api` at `apps/api`. Verbatim.
- All packages are ESM (`"type": "module"`); `moduleResolution: "Bundler"`, `strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`. Verbatim.
- **All business logic and validation live ONLY in `packages/core`.** REST routes are thin: parse/validate → call a core service → return JSON. No queries or business rules in `apps/api`. Verbatim.
- **Services are plain objects.** Each service method takes `(db: Db, ...args)`. No classes, no hidden global DB. Verbatim.
- **Zod schemas are defined once** in `packages/core/src/schemas/*` and reused by REST (this phase) and MCP (Phase 4). Never redefine validation in an adapter. Verbatim.
- **Custom errors** (`packages/core/src/errors.ts`): `NotFoundError`, `ValidationError`, `ConflictError`. Services throw these; adapters translate them. Verbatim.
- **Tests:** Vitest, in-memory DB via `createDb(':memory:')` + `runMigrations(db)`. Strict TDD: write a failing test → run (fails) → minimal impl → run (passes) → commit. Every code step below shows COMPLETE real code.
- Task status enum: `backlog | todo | in_progress | blocked | done | cancelled`. Priority enum: `p0 | p1 | p2 | p3`. Verbatim.
- Subtasks are **one level deep**, enforced in the service (`parent_task_id` on a task that already has a parent → `ConflictError`). Verbatim.
- `done` and `cancelled` set `completed_at`; every other status clears it. `updated_at` is bumped on every mutation. Verbatim.
- The REST server reads its DB path from env `JUSTDOIT_DB` (default `justdoit.db`) and its port from `JUSTDOIT_API_PORT` (default `8787`). Verbatim.

---

## File Structure

```
justdoit/
├── turbo.json                                  # MODIFY: add persistent `dev` task
├── package.json                                # MODIFY: add root `dev` script
├── packages/core/src/
│   ├── index.ts                                # MODIFY: re-export errors, schemas, services
│   ├── errors.ts                               # NEW
│   ├── schemas/
│   │   ├── index.ts                            # NEW: barrel
│   │   ├── project.ts                          # NEW: create/update project schemas
│   │   ├── tag.ts                              # NEW: create/update tag schemas
│   │   ├── task.ts                             # NEW: create/update/status/list schemas
│   │   └── quick-add.ts                        # NEW: quick-add request schema
│   └── services/
│       ├── index.ts                            # NEW: barrel
│       ├── project-service.ts                  # NEW
│       ├── project-service.test.ts             # NEW
│       ├── tag-service.ts                      # NEW
│       ├── tag-service.test.ts                 # NEW
│       ├── task-service.ts                     # NEW
│       ├── task-service.test.ts                # NEW
│       ├── quick-add.ts                        # NEW (parser + service)
│       ├── quick-add.test.ts                   # NEW
│       ├── export-service.ts                   # NEW
│       └── export-service.test.ts              # NEW
└── apps/api/
    ├── package.json                            # NEW
    ├── tsconfig.json                           # NEW
    ├── vitest.config.ts                        # NEW
    └── src/
        ├── index.ts                            # NEW: bootstrap (env DB, migrate, serve)
        ├── app.ts                              # NEW: createApp(db) factory
        ├── middleware/error.ts                 # NEW: error → HTTP mapping
        └── routes/
            ├── health.ts                       # NEW
            ├── projects.ts                     # NEW
            ├── tags.ts                         # NEW
            ├── tasks.ts                        # NEW (+ status, complete, subtasks)
            ├── search.ts                       # NEW: GET /search?q=
            ├── quick-add.ts                    # NEW: POST /quick-add
            └── transfer.ts                     # NEW: GET /export, POST /import
        └── src/app.test.ts, routes/*.test.ts   # NEW: integration tests
```

---

## Task 1: Core errors + Zod schemas

**Files:**

- Create: `packages/core/src/errors.ts`
- Create: `packages/core/src/schemas/project.ts`
- Create: `packages/core/src/schemas/tag.ts`
- Create: `packages/core/src/schemas/task.ts`
- Create: `packages/core/src/schemas/quick-add.ts`
- Create: `packages/core/src/schemas/index.ts`
- Create: `packages/core/src/schemas/schemas.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `TASK_STATUSES`, `TASK_PRIORITIES` from `../db/schema` (Phase 0).
- Produces:
  - `class NotFoundError extends Error` — `constructor(entity: string, id: string)`; `.name = 'NotFoundError'`.
  - `class ValidationError extends Error` — `constructor(message: string)`; `.name = 'ValidationError'`.
  - `class ConflictError extends Error` — `constructor(message: string)`; `.name = 'ConflictError'`.
  - Zod schemas + inferred input types (all exported from `@justdoit/core`):
    - `createProjectSchema` / `CreateProjectInput`, `updateProjectSchema` / `UpdateProjectInput`
    - `createTagSchema` / `CreateTagInput`, `updateTagSchema` / `UpdateTagInput`
    - `createTaskSchema` / `CreateTaskInput`, `updateTaskSchema` / `UpdateTaskInput`, `setStatusSchema` / `SetStatusInput`
    - `quickAddSchema` / `QuickAddInput`

- [ ] **Step 1: Write the failing test — `packages/core/src/schemas/schemas.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  createTaskSchema,
  updateTaskSchema,
  setStatusSchema,
  createProjectSchema,
  createTagSchema,
  quickAddSchema,
} from './index';
import { NotFoundError, ValidationError, ConflictError } from '../errors';

describe('errors', () => {
  it('NotFoundError carries entity + id in the message', () => {
    const err = new NotFoundError('Task', 'abc');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NotFoundError');
    expect(err.message).toContain('Task');
    expect(err.message).toContain('abc');
  });

  it('ValidationError and ConflictError set their names', () => {
    expect(new ValidationError('bad').name).toBe('ValidationError');
    expect(new ConflictError('dup').name).toBe('ConflictError');
  });
});

describe('task schemas', () => {
  it('requires a non-empty title', () => {
    expect(createTaskSchema.safeParse({ title: '' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'ok' }).success).toBe(true);
  });

  it('coerces an ISO due date string to a Date', () => {
    const parsed = createTaskSchema.parse({ title: 't', dueAt: '2026-07-09T17:00:00.000Z' });
    expect(parsed.dueAt).toBeInstanceOf(Date);
  });

  it('rejects an unknown priority', () => {
    expect(createTaskSchema.safeParse({ title: 't', priority: 'p9' }).success).toBe(false);
  });

  it('setStatusSchema only accepts known statuses', () => {
    expect(setStatusSchema.safeParse({ status: 'done' }).success).toBe(true);
    expect(setStatusSchema.safeParse({ status: 'nope' }).success).toBe(false);
  });

  it('updateTaskSchema allows a partial patch', () => {
    expect(updateTaskSchema.safeParse({}).success).toBe(true);
    expect(updateTaskSchema.safeParse({ archived: true }).success).toBe(true);
  });
});

describe('project / tag / quick-add schemas', () => {
  it('project and tag require a name', () => {
    expect(createProjectSchema.safeParse({ name: '' }).success).toBe(false);
    expect(createTagSchema.safeParse({ name: 'errands' }).success).toBe(true);
  });

  it('quickAddSchema requires non-empty text', () => {
    expect(quickAddSchema.safeParse({ text: '' }).success).toBe(false);
    expect(quickAddSchema.safeParse({ text: 'buy milk tomorrow' }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/core test`
Expected: FAIL — cannot resolve `./index` (schemas barrel) / `../errors` (modules do not exist yet).

- [ ] **Step 3: Write `packages/core/src/errors.ts`**

```ts
export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}
```

- [ ] **Step 4: Write `packages/core/src/schemas/project.ts`**

```ts
import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().min(1),
  color: z.string().nullish(),
  icon: z.string().nullish(),
  description: z.string().nullish(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial().extend({
  position: z.number().optional(),
  archived: z.boolean().optional(),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
```

- [ ] **Step 5: Write `packages/core/src/schemas/tag.ts`**

```ts
import { z } from 'zod';

export const createTagSchema = z.object({
  name: z.string().min(1),
  color: z.string().nullish(),
});
export type CreateTagInput = z.infer<typeof createTagSchema>;

export const updateTagSchema = createTagSchema.partial();
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
```

- [ ] **Step 6: Write `packages/core/src/schemas/task.ts`**

```ts
import { z } from 'zod';
import { TASK_STATUSES, TASK_PRIORITIES } from '../db/schema';

export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullish(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).nullish(),
  projectId: z.string().nullish(),
  parentTaskId: z.string().nullish(),
  dueAt: z.coerce.date().nullish(),
  startAt: z.coerce.date().nullish(),
  estimateMinutes: z.number().int().positive().nullish(),
  recurrence: z.string().nullish(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

// Status is changed via setStatus; parentTaskId via addSubtask. Both are excluded here.
export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullish(),
  priority: z.enum(TASK_PRIORITIES).nullish(),
  projectId: z.string().nullish(),
  dueAt: z.coerce.date().nullish(),
  startAt: z.coerce.date().nullish(),
  estimateMinutes: z.number().int().positive().nullish(),
  recurrence: z.string().nullish(),
  position: z.number().optional(),
  archived: z.boolean().optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const setStatusSchema = z.object({ status: z.enum(TASK_STATUSES) });
export type SetStatusInput = z.infer<typeof setStatusSchema>;
```

- [ ] **Step 7: Write `packages/core/src/schemas/quick-add.ts`**

```ts
import { z } from 'zod';

export const quickAddSchema = z.object({ text: z.string().min(1) });
export type QuickAddInput = z.infer<typeof quickAddSchema>;
```

- [ ] **Step 8: Write `packages/core/src/schemas/index.ts`**

```ts
export * from './project';
export * from './tag';
export * from './task';
export * from './quick-add';
```

- [ ] **Step 9: Wire the exports — modify `packages/core/src/index.ts`**

Replace the file contents with:

```ts
export * from './db';
export * from './errors';
export * from './schemas';
export * from './services';
```

> Note: `./services` does not exist yet — create a temporary placeholder so this compiles now, then it is filled in Tasks 2-6:
>
> Create `packages/core/src/services/index.ts` with a single line:
>
> ```ts
> export {};
> ```

- [ ] **Step 10: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/core test`
Expected: PASS — all `schemas.test.ts` cases green.

- [ ] **Step 11: Typecheck**

Run: `pnpm --filter @justdoit/core typecheck`
Expected: PASS — no type errors.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(core): add domain errors and shared Zod schemas"
```

---

## Task 2: `projectService` (CRUD + list)

**Files:**

- Create: `packages/core/src/services/project-service.ts`
- Create: `packages/core/src/services/project-service.test.ts`
- Modify: `packages/core/src/services/index.ts`

**Interfaces:**

- Consumes: `Db` (Phase 0), `projects` table, `NotFoundError`, `createProjectSchema` / `updateProjectSchema` and their inferred types.
- Produces `projectService`:
  - `create(db: Db, input: CreateProjectInput): Project` — validates, assigns next `position`, returns the row.
  - `get(db: Db, id: string): Project` — throws `NotFoundError('Project', id)` if missing.
  - `list(db: Db, opts?: { archived?: boolean }): Project[]` — ordered by `position` then `createdAt`; `archived` filters when provided (omit → all).
  - `update(db: Db, id: string, patch: UpdateProjectInput): Project` — validates, bumps `updatedAt`, throws `NotFoundError` if missing.
  - `remove(db: Db, id: string): void` — throws `NotFoundError` if missing. (Tasks' `project_id` is `ON DELETE SET NULL` → they fall back to Inbox.)

- [ ] **Step 1: Write the failing test — `packages/core/src/services/project-service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { projectService } from './project-service';
import { NotFoundError } from '../errors';

function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

describe('projectService', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });

  it('creates and reads back a project', () => {
    const p = projectService.create(db, { name: 'Work', color: '#f00' });
    expect(p.id).toMatch(/[0-9a-f-]{36}/);
    expect(p.name).toBe('Work');
    expect(projectService.get(db, p.id).name).toBe('Work');
  });

  it('assigns increasing positions', () => {
    const a = projectService.create(db, { name: 'A' });
    const b = projectService.create(db, { name: 'B' });
    expect(b.position).toBeGreaterThan(a.position);
  });

  it('get throws NotFoundError for a missing id', () => {
    expect(() => projectService.get(db, 'nope')).toThrow(NotFoundError);
  });

  it('lists projects and filters by archived', () => {
    const a = projectService.create(db, { name: 'A' });
    projectService.create(db, { name: 'B' });
    projectService.update(db, a.id, { archived: true });
    expect(projectService.list(db)).toHaveLength(2);
    expect(projectService.list(db, { archived: false })).toHaveLength(1);
    expect(projectService.list(db, { archived: true })).toHaveLength(1);
  });

  it('updates fields and bumps updatedAt', () => {
    const p = projectService.create(db, { name: 'A' });
    const updated = projectService.update(db, p.id, { name: 'A2' });
    expect(updated.name).toBe('A2');
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(p.updatedAt.getTime());
  });

  it('removes a project', () => {
    const p = projectService.create(db, { name: 'A' });
    projectService.remove(db, p.id);
    expect(() => projectService.get(db, p.id)).toThrow(NotFoundError);
    expect(() => projectService.remove(db, p.id)).toThrow(NotFoundError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/core test project-service`
Expected: FAIL — cannot resolve `./project-service`.

- [ ] **Step 3: Write the implementation — `packages/core/src/services/project-service.ts`**

```ts
import { and, eq, asc } from 'drizzle-orm';
import type { Db } from '../db';
import { projects, type Project } from '../db/schema';
import { NotFoundError } from '../errors';
import {
  createProjectSchema,
  updateProjectSchema,
  type CreateProjectInput,
  type UpdateProjectInput,
} from '../schemas';

function nextPosition(db: Db): number {
  const rows = db.select({ position: projects.position }).from(projects).all();
  return rows.reduce((max, r) => Math.max(max, r.position), 0) + 1;
}

export const projectService = {
  create(db: Db, input: CreateProjectInput): Project {
    const parsed = createProjectSchema.parse(input);
    const [row] = db
      .insert(projects)
      .values({ ...parsed, position: nextPosition(db) })
      .returning()
      .all();
    return row!;
  },

  get(db: Db, id: string): Project {
    const row = db.select().from(projects).where(eq(projects.id, id)).get();
    if (!row) throw new NotFoundError('Project', id);
    return row;
  },

  list(db: Db, opts: { archived?: boolean } = {}): Project[] {
    const where = opts.archived === undefined ? undefined : eq(projects.archived, opts.archived);
    return db
      .select()
      .from(projects)
      .where(where)
      .orderBy(asc(projects.position), asc(projects.createdAt))
      .all();
  },

  update(db: Db, id: string, patch: UpdateProjectInput): Project {
    const parsed = updateProjectSchema.parse(patch);
    projectService.get(db, id);
    const [row] = db
      .update(projects)
      .set({ ...parsed, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning()
      .all();
    return row!;
  },

  remove(db: Db, id: string): void {
    projectService.get(db, id);
    db.delete(projects).where(eq(projects.id, id)).run();
  },
};
```

> The unused `and` import above is intentional-free — remove it if ESLint flags it; only `eq`/`asc` are used. (Keep the import list to exactly what is referenced.)

Correct import line (use this):

```ts
import { eq, asc } from 'drizzle-orm';
```

- [ ] **Step 4: Export it — modify `packages/core/src/services/index.ts`**

Replace the placeholder contents with:

```ts
export * from './project-service';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/core test project-service`
Expected: PASS — all `projectService` cases green.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @justdoit/core typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): add projectService (CRUD + list)"
```

---

## Task 3: `tagService` (CRUD + attach/detach)

**Files:**

- Create: `packages/core/src/services/tag-service.ts`
- Create: `packages/core/src/services/tag-service.test.ts`
- Modify: `packages/core/src/services/index.ts`

**Interfaces:**

- Consumes: `Db`, `tags`/`taskTags`/`tasks` tables, `NotFoundError`/`ConflictError`, `createTagSchema`/`updateTagSchema`.
- Produces `tagService`:
  - `create(db: Db, input: CreateTagInput): Tag` — unique `name`; duplicate → `ConflictError`.
  - `get(db: Db, id: string): Tag` — `NotFoundError` if missing.
  - `list(db: Db): Tag[]` — ordered by `name`.
  - `update(db: Db, id: string, patch: UpdateTagInput): Tag` — bumps `updatedAt`; renaming to an existing name → `ConflictError`.
  - `remove(db: Db, id: string): void`.
  - `attach(db: Db, taskId: string, tagId: string): void` — verifies both exist; idempotent (composite PK, `onConflictDoNothing`).
  - `detach(db: Db, taskId: string, tagId: string): void` — removes the link (no error if absent).
  - `listForTask(db: Db, taskId: string): Tag[]` — tags linked to a task, ordered by `name`.

- [ ] **Step 1: Write the failing test — `packages/core/src/services/tag-service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, tasks, type Db } from '../db';
import { tagService } from './tag-service';
import { NotFoundError, ConflictError } from '../errors';

function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

describe('tagService', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });

  it('creates a tag and rejects duplicate names', () => {
    const t = tagService.create(db, { name: 'errands', color: '#0f0' });
    expect(t.name).toBe('errands');
    expect(() => tagService.create(db, { name: 'errands' })).toThrow(ConflictError);
  });

  it('lists tags alphabetically', () => {
    tagService.create(db, { name: 'zeta' });
    tagService.create(db, { name: 'alpha' });
    expect(tagService.list(db).map((t) => t.name)).toEqual(['alpha', 'zeta']);
  });

  it('updates and removes a tag', () => {
    const t = tagService.create(db, { name: 'a' });
    expect(tagService.update(db, t.id, { name: 'b' }).name).toBe('b');
    tagService.remove(db, t.id);
    expect(() => tagService.get(db, t.id)).toThrow(NotFoundError);
  });

  it('attaches and detaches tags on a task (idempotent)', () => {
    // Task 3 stays self-contained: insert the parent task directly via the schema
    // rather than importing taskService (implemented later in Task 4).
    const task = db.insert(tasks).values({ title: 'x' }).returning().all()[0]!;
    const tag = tagService.create(db, { name: 'home' });
    tagService.attach(db, task.id, tag.id);
    tagService.attach(db, task.id, tag.id); // idempotent
    expect(tagService.listForTask(db, task.id).map((t) => t.name)).toEqual(['home']);
    tagService.detach(db, task.id, tag.id);
    expect(tagService.listForTask(db, task.id)).toHaveLength(0);
  });

  it('attach throws NotFoundError for a missing task or tag', () => {
    const task = db.insert(tasks).values({ title: 'x' }).returning().all()[0]!;
    expect(() => tagService.attach(db, task.id, 'nope')).toThrow(NotFoundError);
    expect(() => tagService.attach(db, 'nope', 'nope')).toThrow(NotFoundError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/core test tag-service`
Expected: FAIL — cannot resolve `./tag-service` (module does not exist yet). The test is self-contained: it seeds parent tasks via a direct `db.insert(tasks)` and does NOT import `taskService`, so this task has no dependency on Task 4.

- [ ] **Step 3: Write the implementation — `packages/core/src/services/tag-service.ts`**

```ts
import { eq, asc, and } from 'drizzle-orm';
import type { Db } from '../db';
import { tags, taskTags, tasks, type Tag } from '../db/schema';
import { NotFoundError, ConflictError } from '../errors';
import {
  createTagSchema,
  updateTagSchema,
  type CreateTagInput,
  type UpdateTagInput,
} from '../schemas';

function requireTask(db: Db, taskId: string): void {
  const row = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).get();
  if (!row) throw new NotFoundError('Task', taskId);
}

export const tagService = {
  create(db: Db, input: CreateTagInput): Tag {
    const parsed = createTagSchema.parse(input);
    const existing = db.select().from(tags).where(eq(tags.name, parsed.name)).get();
    if (existing) throw new ConflictError(`Tag already exists: ${parsed.name}`);
    const [row] = db.insert(tags).values(parsed).returning().all();
    return row!;
  },

  get(db: Db, id: string): Tag {
    const row = db.select().from(tags).where(eq(tags.id, id)).get();
    if (!row) throw new NotFoundError('Tag', id);
    return row;
  },

  list(db: Db): Tag[] {
    return db.select().from(tags).orderBy(asc(tags.name)).all();
  },

  update(db: Db, id: string, patch: UpdateTagInput): Tag {
    const parsed = updateTagSchema.parse(patch);
    tagService.get(db, id);
    if (parsed.name !== undefined) {
      const clash = db.select().from(tags).where(eq(tags.name, parsed.name)).get();
      if (clash && clash.id !== id) throw new ConflictError(`Tag already exists: ${parsed.name}`);
    }
    const [row] = db
      .update(tags)
      .set({ ...parsed, updatedAt: new Date() })
      .where(eq(tags.id, id))
      .returning()
      .all();
    return row!;
  },

  remove(db: Db, id: string): void {
    tagService.get(db, id);
    db.delete(tags).where(eq(tags.id, id)).run();
  },

  attach(db: Db, taskId: string, tagId: string): void {
    requireTask(db, taskId);
    tagService.get(db, tagId);
    db.insert(taskTags).values({ taskId, tagId }).onConflictDoNothing().run();
  },

  detach(db: Db, taskId: string, tagId: string): void {
    db.delete(taskTags)
      .where(and(eq(taskTags.taskId, taskId), eq(taskTags.tagId, tagId)))
      .run();
  },

  listForTask(db: Db, taskId: string): Tag[] {
    return db
      .select({
        id: tags.id,
        name: tags.name,
        color: tags.color,
        createdAt: tags.createdAt,
        updatedAt: tags.updatedAt,
      })
      .from(taskTags)
      .innerJoin(tags, eq(taskTags.tagId, tags.id))
      .where(eq(taskTags.taskId, taskId))
      .orderBy(asc(tags.name))
      .all();
  },
};
```

- [ ] **Step 4: Export it — modify `packages/core/src/services/index.ts`**

```ts
export * from './project-service';
export * from './tag-service';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/core test tag-service`
Expected: PASS — all `tagService` cases green (the test seeds tasks directly, so nothing here depends on Task 4).

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @justdoit/core typecheck`
Expected: PASS — the suite is self-contained (no `taskService` import).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): add tagService (CRUD + attach/detach)"
```

---

## Task 4: `taskService` (create/get/list+filters/update/setStatus/complete/remove/subtasks/ordering)

**Files:**

- Create: `packages/core/src/services/task-service.ts`
- Create: `packages/core/src/services/task-service.test.ts`
- Modify: `packages/core/src/services/index.ts`

**Interfaces:**

- Consumes: `Db`, `tasks`/`taskTags`/`projects` tables, `TaskStatus`, `NotFoundError`/`ConflictError`, `createTaskSchema`/`updateTaskSchema`.
- Produces `taskService` and `interface TaskListFilters`:

  ```ts
  export interface TaskListFilters {
    status?: TaskStatus;
    projectId?: string | null; // null → Inbox (project_id IS NULL)
    tagId?: string;
    priority?: TaskPriority;
    parentTaskId?: string | null; // null → top-level only
    archived?: boolean;
    search?: string; // LIKE over title + description
  }
  ```

  - `create(db: Db, input: CreateTaskInput): Task` — validates; if `projectId` set, verifies it exists; if `parentTaskId` set, verifies parent exists and is top-level (else `ConflictError`); assigns next `position` within its `(projectId, parentTaskId)` scope.
  - `get(db: Db, id: string): Task` — `NotFoundError` if missing.
  - `list(db: Db, filters?: TaskListFilters): Task[]` — AND-composed filters, `tagId` via `task_tags`, `search` via `LIKE`; ordered by `position` then `createdAt`.
  - `update(db: Db, id: string, patch: UpdateTaskInput): Task` — validates, bumps `updatedAt`.
  - `setStatus(db: Db, id: string, status: TaskStatus): Task` — sets `completedAt = now` for `done`/`cancelled`, else `completedAt = null`; bumps `updatedAt`.
  - `complete(db: Db, id: string, now?: Date): Task` — `setStatus(db, id, 'done')`. The trailing optional `now` (default `new Date()`) is accepted here so Phase 3 can anchor recurrence spawn-on-complete without changing the signature.
  - `remove(db: Db, id: string): void` — deletes; child subtasks cascade (`ON DELETE CASCADE` in schema).
  - `addSubtask(db: Db, parentId: string, input: CreateTaskInput): Task` — verifies parent exists and is top-level, then `create` with `parentTaskId = parentId`.
  - `listSubtasks(db: Db, parentId: string): Task[]` — direct children ordered by `position`.

- [ ] **Step 1: Write the failing test — `packages/core/src/services/task-service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { taskService } from './task-service';
import { projectService } from './project-service';
import { tagService } from './tag-service';
import { NotFoundError, ConflictError } from '../errors';

function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

describe('taskService', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });

  it('creates a task with defaults (status todo, no completedAt)', () => {
    const t = taskService.create(db, { title: 'Write plan' });
    expect(t.title).toBe('Write plan');
    expect(t.status).toBe('todo');
    expect(t.completedAt).toBeNull();
  });

  it('rejects a task pointing at a non-existent project', () => {
    expect(() => taskService.create(db, { title: 'x', projectId: 'nope' })).toThrow(NotFoundError);
  });

  it('assigns increasing positions within a scope', () => {
    const a = taskService.create(db, { title: 'a' });
    const b = taskService.create(db, { title: 'b' });
    expect(b.position).toBeGreaterThan(a.position);
  });

  it('setStatus sets completedAt for done and clears it otherwise', () => {
    const t = taskService.create(db, { title: 'x' });
    const done = taskService.setStatus(db, t.id, 'done');
    expect(done.status).toBe('done');
    expect(done.completedAt).toBeInstanceOf(Date);
    const reopened = taskService.setStatus(db, t.id, 'todo');
    expect(reopened.completedAt).toBeNull();
  });

  it('complete() marks a task done', () => {
    const t = taskService.create(db, { title: 'x' });
    expect(taskService.complete(db, t.id).status).toBe('done');
  });

  it('cancelled also sets completedAt', () => {
    const t = taskService.create(db, { title: 'x' });
    expect(taskService.setStatus(db, t.id, 'cancelled').completedAt).toBeInstanceOf(Date);
  });

  it('adds a subtask but forbids nesting beyond one level', () => {
    const parent = taskService.create(db, { title: 'parent' });
    const child = taskService.addSubtask(db, parent.id, { title: 'child' });
    expect(child.parentTaskId).toBe(parent.id);
    expect(taskService.listSubtasks(db, parent.id).map((t) => t.title)).toEqual(['child']);
    expect(() => taskService.addSubtask(db, child.id, { title: 'grandchild' })).toThrow(
      ConflictError,
    );
  });

  it('filters by status, project, priority, archived, parentTaskId', () => {
    const proj = projectService.create(db, { name: 'P' });
    taskService.create(db, { title: 'a', projectId: proj.id, priority: 'p1' });
    const b = taskService.create(db, { title: 'b', status: 'in_progress' });
    taskService.update(db, b.id, { archived: true });

    expect(taskService.list(db, { projectId: proj.id })).toHaveLength(1);
    expect(taskService.list(db, { projectId: null })).toHaveLength(1); // Inbox = b
    expect(taskService.list(db, { priority: 'p1' })).toHaveLength(1);
    expect(taskService.list(db, { status: 'in_progress' })).toHaveLength(1);
    expect(taskService.list(db, { archived: true })).toHaveLength(1);
    expect(taskService.list(db, { parentTaskId: null })).toHaveLength(2); // both top-level
  });

  it('filters by tagId and free-text search', () => {
    const a = taskService.create(db, { title: 'buy milk', description: 'at the store' });
    taskService.create(db, { title: 'call bank' });
    const tag = tagService.create(db, { name: 'errands' });
    tagService.attach(db, a.id, tag.id);

    expect(taskService.list(db, { tagId: tag.id }).map((t) => t.title)).toEqual(['buy milk']);
    expect(taskService.list(db, { search: 'milk' }).map((t) => t.title)).toEqual(['buy milk']);
    expect(taskService.list(db, { search: 'store' }).map((t) => t.title)).toEqual(['buy milk']);
    expect(taskService.list(db, { search: 'zzz' })).toHaveLength(0);
  });

  it('removes a task and cascades its subtasks', () => {
    const parent = taskService.create(db, { title: 'parent' });
    taskService.addSubtask(db, parent.id, { title: 'child' });
    taskService.remove(db, parent.id);
    expect(() => taskService.get(db, parent.id)).toThrow(NotFoundError);
    expect(taskService.list(db)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/core test task-service`
Expected: FAIL — cannot resolve `./task-service`.

- [ ] **Step 3: Write the implementation — `packages/core/src/services/task-service.ts`**

```ts
import { and, or, eq, asc, isNull, like, inArray, type SQL } from 'drizzle-orm';
import type { Db } from '../db';
import {
  tasks,
  taskTags,
  projects,
  type Task,
  type TaskStatus,
  type TaskPriority,
} from '../db/schema';
import { NotFoundError, ConflictError } from '../errors';
import {
  createTaskSchema,
  updateTaskSchema,
  type CreateTaskInput,
  type UpdateTaskInput,
} from '../schemas';

export interface TaskListFilters {
  status?: TaskStatus;
  projectId?: string | null;
  tagId?: string;
  priority?: TaskPriority;
  parentTaskId?: string | null;
  archived?: boolean;
  search?: string;
}

function nextPosition(db: Db, projectId: string | null, parentTaskId: string | null): number {
  const rows = db
    .select({ position: tasks.position })
    .from(tasks)
    .where(
      and(
        projectId === null ? isNull(tasks.projectId) : eq(tasks.projectId, projectId),
        parentTaskId === null ? isNull(tasks.parentTaskId) : eq(tasks.parentTaskId, parentTaskId),
      ),
    )
    .all();
  return rows.reduce((max, r) => Math.max(max, r.position), 0) + 1;
}

function requireProject(db: Db, projectId: string): void {
  const row = db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get();
  if (!row) throw new NotFoundError('Project', projectId);
}

export const taskService = {
  create(db: Db, input: CreateTaskInput): Task {
    const parsed = createTaskSchema.parse(input);
    if (parsed.projectId) requireProject(db, parsed.projectId);
    if (parsed.parentTaskId) {
      const parent = taskService.get(db, parsed.parentTaskId);
      if (parent.parentTaskId) {
        throw new ConflictError('Subtasks may only be one level deep');
      }
    }
    const position = nextPosition(db, parsed.projectId ?? null, parsed.parentTaskId ?? null);
    const [row] = db
      .insert(tasks)
      .values({ ...parsed, position })
      .returning()
      .all();
    return row!;
  },

  get(db: Db, id: string): Task {
    const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!row) throw new NotFoundError('Task', id);
    return row;
  },

  list(db: Db, filters: TaskListFilters = {}): Task[] {
    const conditions: SQL[] = [];
    if (filters.status) conditions.push(eq(tasks.status, filters.status));
    if (filters.priority) conditions.push(eq(tasks.priority, filters.priority));
    if (filters.projectId !== undefined) {
      conditions.push(
        filters.projectId === null
          ? isNull(tasks.projectId)
          : eq(tasks.projectId, filters.projectId),
      );
    }
    if (filters.parentTaskId !== undefined) {
      conditions.push(
        filters.parentTaskId === null
          ? isNull(tasks.parentTaskId)
          : eq(tasks.parentTaskId, filters.parentTaskId),
      );
    }
    if (filters.archived !== undefined) conditions.push(eq(tasks.archived, filters.archived));
    if (filters.search) {
      const needle = `%${filters.search}%`;
      conditions.push(or(like(tasks.title, needle), like(tasks.description, needle))!);
    }
    if (filters.tagId) {
      const taskIds = db
        .select({ id: taskTags.taskId })
        .from(taskTags)
        .where(eq(taskTags.tagId, filters.tagId))
        .all()
        .map((r) => r.id);
      conditions.push(inArray(tasks.id, taskIds.length ? taskIds : ['�__none__']));
    }
    return db
      .select()
      .from(tasks)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(tasks.position), asc(tasks.createdAt))
      .all();
  },

  update(db: Db, id: string, patch: UpdateTaskInput): Task {
    const parsed = updateTaskSchema.parse(patch);
    taskService.get(db, id);
    if (parsed.projectId) requireProject(db, parsed.projectId);
    const [row] = db
      .update(tasks)
      .set({ ...parsed, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning()
      .all();
    return row!;
  },

  setStatus(db: Db, id: string, status: TaskStatus): Task {
    taskService.get(db, id);
    const completedAt = status === 'done' || status === 'cancelled' ? new Date() : null;
    const [row] = db
      .update(tasks)
      .set({ status, completedAt, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning()
      .all();
    return row!;
  },

  // `now` is accepted (default new Date()) for signature stability; Phase 3 uses it
  // to anchor recurrence spawn-on-complete. Phase 1's body does not yet read it.
  complete(db: Db, id: string, now: Date = new Date()): Task {
    void now;
    return taskService.setStatus(db, id, 'done');
  },

  remove(db: Db, id: string): void {
    taskService.get(db, id);
    db.delete(tasks).where(eq(tasks.id, id)).run();
  },

  addSubtask(db: Db, parentId: string, input: CreateTaskInput): Task {
    const parent = taskService.get(db, parentId);
    if (parent.parentTaskId) {
      throw new ConflictError('Subtasks may only be one level deep');
    }
    return taskService.create(db, { ...input, parentTaskId: parentId });
  },

  listSubtasks(db: Db, parentId: string): Task[] {
    return db
      .select()
      .from(tasks)
      .where(eq(tasks.parentTaskId, parentId))
      .orderBy(asc(tasks.position), asc(tasks.createdAt))
      .all();
  },
};
```

- [ ] **Step 4: Export it — modify `packages/core/src/services/index.ts`**

```ts
export * from './project-service';
export * from './tag-service';
export * from './task-service';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @justdoit/core test task-service tag-service`
Expected: PASS — both suites green (`tagService`'s attach/detach cases now resolve `taskService`).

- [ ] **Step 6: Typecheck + full core suite**

Run: `pnpm --filter @justdoit/core typecheck && pnpm --filter @justdoit/core test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): add taskService (CRUD, status lifecycle, subtasks, filters)"
```

---

## Task 5: `quickAddService` — natural-language quick-add parser

**Files:**

- Create: `packages/core/src/services/quick-add.ts`
- Create: `packages/core/src/services/quick-add.test.ts`
- Modify: `packages/core/src/services/index.ts`

**Interfaces:**

- Consumes: `Db`, `projects`/`tags` tables, `projectService`/`tagService`/`taskService`, `ValidationError`, `TaskPriority`.
- Produces:

  ```ts
  export interface QuickAddParsed {
    title: string;
    dueAt?: Date;
    priority?: TaskPriority;
    tags: string[]; // names, from #token
    projectName?: string; // from @token
  }
  export function parseQuickAdd(text: string, now?: Date): QuickAddParsed;
  export const quickAddService: {
    parse(text: string, now?: Date): QuickAddParsed;
    create(db: Db, text: string, now?: Date): Task; // resolves/creates project + tags, then creates the task
  };
  ```

  - Grammar (dependency-light, whitespace-tokenized): `#foo` → tag; `@foo` → project name; `p0|p1|p2|p3` (bare token) → priority; date words `today`, `tomorrow`, weekday names (`monday`..`sunday`, next occurrence) → due date; times `5pm`, `5:30pm`, `17:00` → due time. A date word without a time defaults to `09:00`; a time without a date word means today. Everything else is the title. Tests pass a fixed `now` — no reliance on the real clock.

- [ ] **Step 1: Write the failing test — `packages/core/src/services/quick-add.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { parseQuickAdd, quickAddService } from './quick-add';
import { projectService } from './project-service';
import { tagService } from './tag-service';

// Wed 2026-07-08 10:00 local
const NOW = new Date(2026, 6, 8, 10, 0, 0, 0);

describe('parseQuickAdd', () => {
  it('parses a full string: title, tomorrow 5pm, tag, priority', () => {
    const r = parseQuickAdd('buy milk tomorrow 5pm #errands p1', NOW);
    expect(r.title).toBe('buy milk');
    expect(r.tags).toEqual(['errands']);
    expect(r.priority).toBe('p1');
    expect(r.dueAt).toEqual(new Date(2026, 6, 9, 17, 0, 0, 0));
  });

  it('parses a project token and multiple tags', () => {
    const r = parseQuickAdd('draft spec @work #writing #focus', NOW);
    expect(r.title).toBe('draft spec');
    expect(r.projectName).toBe('work');
    expect(r.tags).toEqual(['writing', 'focus']);
    expect(r.dueAt).toBeUndefined();
  });

  it('today defaults to 09:00 when no time is given', () => {
    const r = parseQuickAdd('standup today', NOW);
    expect(r.dueAt).toEqual(new Date(2026, 6, 8, 9, 0, 0, 0));
  });

  it('a bare time means today at that time', () => {
    const r = parseQuickAdd('lunch 12:30', NOW);
    expect(r.dueAt).toEqual(new Date(2026, 6, 8, 12, 30, 0, 0));
  });

  it('a weekday resolves to the next occurrence', () => {
    const r = parseQuickAdd('gym monday', NOW); // NOW is Wed -> next Mon = 2026-07-13
    expect(r.dueAt).toEqual(new Date(2026, 6, 13, 9, 0, 0, 0));
  });

  it('does not treat a bare integer as a time', () => {
    const r = parseQuickAdd('read 5 pages', NOW);
    expect(r.title).toBe('read 5 pages');
    expect(r.dueAt).toBeUndefined();
  });
});

describe('quickAddService.create', () => {
  let db: Db;
  beforeEach(() => {
    const created = createDb(':memory:');
    runMigrations(created.db);
    db = created.db;
  });

  it('creates the task, project, and tags from one string', () => {
    const task = quickAddService.create(db, 'buy milk tomorrow 5pm @errands-list #errands p1', NOW);
    expect(task.title).toBe('buy milk');
    expect(task.priority).toBe('p1');
    expect(task.dueAt).toEqual(new Date(2026, 6, 9, 17, 0, 0, 0));
    expect(projectService.get(db, task.projectId!).name).toBe('errands-list');
    expect(tagService.listForTask(db, task.id).map((t) => t.name)).toEqual(['errands']);
  });

  it('reuses an existing project and tag by name', () => {
    const proj = projectService.create(db, { name: 'work' });
    const tag = tagService.create(db, { name: 'writing' });
    const task = quickAddService.create(db, 'draft @work #writing', NOW);
    expect(task.projectId).toBe(proj.id);
    expect(tagService.listForTask(db, task.id)[0]!.id).toBe(tag.id);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/core test quick-add`
Expected: FAIL — cannot resolve `./quick-add`.

- [ ] **Step 3: Write the implementation — `packages/core/src/services/quick-add.ts`**

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { projects, tags, type Task, type TaskPriority } from '../db/schema';
import { ValidationError } from '../errors';
import { projectService } from './project-service';
import { tagService } from './tag-service';
import { taskService } from './task-service';

export interface QuickAddParsed {
  title: string;
  dueAt?: Date;
  priority?: TaskPriority;
  tags: string[];
  projectName?: string;
}

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

interface TimeOfDay {
  hours: number;
  minutes: number;
}

function parseTime(token: string): TimeOfDay | undefined {
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(token);
  if (!m) return undefined;
  const hasColon = m[2] !== undefined;
  const meridiem = m[3];
  // A bare integer (e.g. "5") is NOT a time; require am/pm or a colon.
  if (!hasColon && !meridiem) return undefined;
  let hours = Number.parseInt(m[1]!, 10);
  const minutes = hasColon ? Number.parseInt(m[2]!, 10) : 0;
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return undefined;
  return { hours, minutes };
}

function computeDueAt(
  now: Date,
  dateWord: string | undefined,
  time: TimeOfDay | undefined,
): Date | undefined {
  if (!dateWord && !time) return undefined;
  const d = new Date(now);
  d.setSeconds(0, 0);
  if (dateWord === 'tomorrow') {
    d.setDate(d.getDate() + 1);
  } else if (dateWord && dateWord !== 'today') {
    const target = WEEKDAYS.indexOf(dateWord as (typeof WEEKDAYS)[number]);
    let diff = (target - d.getDay() + 7) % 7;
    if (diff === 0) diff = 7; // "monday" on a Monday means next Monday
    d.setDate(d.getDate() + diff);
  }
  if (time) {
    d.setHours(time.hours, time.minutes, 0, 0);
  } else {
    d.setHours(9, 0, 0, 0);
  }
  return d;
}

export function parseQuickAdd(text: string, now: Date = new Date()): QuickAddParsed {
  const tagsFound: string[] = [];
  let priority: TaskPriority | undefined;
  let projectName: string | undefined;
  let dateWord: string | undefined;
  let time: TimeOfDay | undefined;
  const titleParts: string[] = [];

  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    if (token.length > 1 && token.startsWith('#')) {
      tagsFound.push(token.slice(1));
      continue;
    }
    if (token.length > 1 && token.startsWith('@')) {
      projectName = token.slice(1);
      continue;
    }
    if (/^p[0-3]$/i.test(token)) {
      priority = token.toLowerCase() as TaskPriority;
      continue;
    }
    const lower = token.toLowerCase();
    if (lower === 'today' || lower === 'tomorrow' || WEEKDAYS.includes(lower as never)) {
      dateWord = lower;
      continue;
    }
    const t = parseTime(lower);
    if (t) {
      time = t;
      continue;
    }
    titleParts.push(token);
  }

  return {
    title: titleParts.join(' '),
    dueAt: computeDueAt(now, dateWord, time),
    priority,
    tags: tagsFound,
    projectName,
  };
}

export const quickAddService = {
  parse(text: string, now: Date = new Date()): QuickAddParsed {
    return parseQuickAdd(text, now);
  },

  create(db: Db, text: string, now: Date = new Date()): Task {
    const parsed = parseQuickAdd(text, now);
    if (!parsed.title) throw new ValidationError('Quick-add text produced an empty title');

    let projectId: string | undefined;
    if (parsed.projectName) {
      const existing = db
        .select()
        .from(projects)
        .where(eq(projects.name, parsed.projectName))
        .get();
      projectId = existing
        ? existing.id
        : projectService.create(db, { name: parsed.projectName }).id;
    }

    const task = taskService.create(db, {
      title: parsed.title,
      priority: parsed.priority ?? null,
      projectId: projectId ?? null,
      dueAt: parsed.dueAt ?? null,
    });

    for (const name of parsed.tags) {
      const existing = db.select().from(tags).where(eq(tags.name, name)).get();
      const tag = existing ?? tagService.create(db, { name });
      tagService.attach(db, task.id, tag.id);
    }

    return taskService.get(db, task.id);
  },
};
```

- [ ] **Step 4: Export it — modify `packages/core/src/services/index.ts`**

```ts
export * from './project-service';
export * from './tag-service';
export * from './task-service';
export * from './quick-add';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/core test quick-add`
Expected: PASS — all parser + service cases green.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @justdoit/core typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): add natural-language quickAddService"
```

---

## Task 6: `exportService` — JSON snapshot import/export

**Files:**

- Create: `packages/core/src/services/export-service.ts`
- Create: `packages/core/src/services/export-service.test.ts`
- Modify: `packages/core/src/services/index.ts`

**Interfaces:**

- Consumes: `Db` and every table from `../db/schema`.
- Produces:

  ```ts
  export interface Snapshot {
    version: 1;
    exportedAt: string; // ISO
    projects: Project[];
    tasks: Task[];
    tags: Tag[];
    taskTags: { taskId: string; tagId: string }[];
    timeEntries: TimeEntry[];
    reminders: (typeof reminders.$inferSelect)[];
    activityLog: (typeof activityLog.$inferSelect)[];
    attachments: (typeof attachments.$inferSelect)[];
    savedFilters: (typeof savedFilters.$inferSelect)[];
  }
  export interface ImportResult {
    counts: Record<
      | 'projects'
      | 'tasks'
      | 'tags'
      | 'taskTags'
      | 'timeEntries'
      | 'reminders'
      | 'activityLog'
      | 'attachments'
      | 'savedFilters',
      number
    >;
  }
  export const exportService: {
    exportSnapshot(db: Db): Snapshot;
    importSnapshot(db: Db, snapshot: Snapshot): ImportResult; // full replace, transactional
  };
  ```

  - `importSnapshot` **replaces** all data inside one transaction: delete every table, then insert in FK-safe order (`projects`, `tags`, top-level `tasks`, subtasks, `taskTags`, `timeEntries`, `reminders`, `attachments`, `activityLog`, `savedFilters`). Malformed input (missing required arrays) → `ValidationError`.

- [ ] **Step 1: Write the failing test — `packages/core/src/services/export-service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { exportService } from './export-service';
import { taskService } from './task-service';
import { projectService } from './project-service';
import { tagService } from './tag-service';
import { ValidationError } from '../errors';

function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

function seed(db: Db): void {
  const proj = projectService.create(db, { name: 'Work' });
  const parent = taskService.create(db, { title: 'parent', projectId: proj.id });
  taskService.addSubtask(db, parent.id, { title: 'child' });
  const tag = tagService.create(db, { name: 'focus' });
  tagService.attach(db, parent.id, tag.id);
}

describe('exportService', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });

  it('exports a snapshot with all rows', () => {
    seed(db);
    const snap = exportService.exportSnapshot(db);
    expect(snap.version).toBe(1);
    expect(snap.projects).toHaveLength(1);
    expect(snap.tasks).toHaveLength(2);
    expect(snap.tags).toHaveLength(1);
    expect(snap.taskTags).toHaveLength(1);
    expect(typeof snap.exportedAt).toBe('string');
  });

  it('round-trips: export from one db, import into another', () => {
    seed(db);
    const snap = exportService.exportSnapshot(db);

    const target = freshDb();
    const result = exportService.importSnapshot(target, snap);
    expect(result.counts.tasks).toBe(2);

    const roundTripped = exportService.exportSnapshot(target);
    expect(roundTripped.projects).toHaveLength(1);
    expect(roundTripped.tasks).toHaveLength(2);
    expect(roundTripped.taskTags).toHaveLength(1);
    // Dates survive as Dates after import.
    expect(taskService.list(target)[0]!.createdAt).toBeInstanceOf(Date);
  });

  it('import replaces existing data', () => {
    seed(db);
    const snap = exportService.exportSnapshot(db);
    const target = freshDb();
    projectService.create(target, { name: 'stale' });
    exportService.importSnapshot(target, snap);
    expect(projectService.list(target).map((p) => p.name)).toEqual(['Work']);
  });

  it('rejects a malformed snapshot', () => {
    expect(() => exportService.importSnapshot(db, {} as never)).toThrow(ValidationError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/core test export-service`
Expected: FAIL — cannot resolve `./export-service`.

- [ ] **Step 3: Write the implementation — `packages/core/src/services/export-service.ts`**

```ts
import type { Db } from '../db';
import {
  projects,
  tasks,
  tags,
  taskTags,
  timeEntries,
  reminders,
  activityLog,
  attachments,
  savedFilters,
  type Project,
  type Task,
  type Tag,
  type TimeEntry,
} from '../db/schema';
import { ValidationError } from '../errors';

export interface Snapshot {
  version: 1;
  exportedAt: string;
  projects: Project[];
  tasks: Task[];
  tags: Tag[];
  taskTags: { taskId: string; tagId: string }[];
  timeEntries: TimeEntry[];
  reminders: (typeof reminders.$inferSelect)[];
  activityLog: (typeof activityLog.$inferSelect)[];
  attachments: (typeof attachments.$inferSelect)[];
  savedFilters: (typeof savedFilters.$inferSelect)[];
}

export interface ImportResult {
  counts: Record<
    | 'projects'
    | 'tasks'
    | 'tags'
    | 'taskTags'
    | 'timeEntries'
    | 'reminders'
    | 'activityLog'
    | 'attachments'
    | 'savedFilters',
    number
  >;
}

const REQUIRED_ARRAYS = [
  'projects',
  'tasks',
  'tags',
  'taskTags',
  'timeEntries',
  'reminders',
  'activityLog',
  'attachments',
  'savedFilters',
] as const;

export const exportService = {
  exportSnapshot(db: Db): Snapshot {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      projects: db.select().from(projects).all(),
      tasks: db.select().from(tasks).all(),
      tags: db.select().from(tags).all(),
      taskTags: db.select().from(taskTags).all(),
      timeEntries: db.select().from(timeEntries).all(),
      reminders: db.select().from(reminders).all(),
      activityLog: db.select().from(activityLog).all(),
      attachments: db.select().from(attachments).all(),
      savedFilters: db.select().from(savedFilters).all(),
    };
  },

  importSnapshot(db: Db, snapshot: Snapshot): ImportResult {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new ValidationError('Snapshot must be an object');
    }
    for (const key of REQUIRED_ARRAYS) {
      if (!Array.isArray((snapshot as Record<string, unknown>)[key])) {
        throw new ValidationError(`Snapshot is missing array: ${key}`);
      }
    }

    // Coerce timestamp fields (which arrive as ISO strings or ms after JSON) back to Date
    // for Drizzle's timestamp_ms columns.
    const toDate = <T extends Record<string, unknown>>(row: T, keys: string[]): T => {
      const copy: Record<string, unknown> = { ...row };
      for (const k of keys) {
        const v = copy[k];
        if (v !== null && v !== undefined && !(v instanceof Date)) {
          copy[k] = new Date(v as string | number);
        }
      }
      return copy as T;
    };

    db.transaction((tx) => {
      // Delete children first (FK-safe).
      tx.delete(taskTags).run();
      tx.delete(timeEntries).run();
      tx.delete(reminders).run();
      tx.delete(attachments).run();
      tx.delete(activityLog).run();
      tx.delete(savedFilters).run();
      tx.delete(tasks).run();
      tx.delete(projects).run();
      tx.delete(tags).run();

      if (snapshot.projects.length) {
        tx.insert(projects)
          .values(snapshot.projects.map((r) => toDate(r, ['createdAt', 'updatedAt'])))
          .run();
      }
      if (snapshot.tags.length) {
        tx.insert(tags)
          .values(snapshot.tags.map((r) => toDate(r, ['createdAt', 'updatedAt'])))
          .run();
      }
      // Insert top-level tasks before subtasks to satisfy the self-referential FK.
      const taskRows = snapshot.tasks.map((r) =>
        toDate(r, ['dueAt', 'startAt', 'completedAt', 'createdAt', 'updatedAt']),
      );
      const topLevel = taskRows.filter((r) => !r.parentTaskId);
      const children = taskRows.filter((r) => r.parentTaskId);
      if (topLevel.length) tx.insert(tasks).values(topLevel).run();
      if (children.length) tx.insert(tasks).values(children).run();

      if (snapshot.taskTags.length) tx.insert(taskTags).values(snapshot.taskTags).run();
      if (snapshot.timeEntries.length) {
        tx.insert(timeEntries)
          .values(
            snapshot.timeEntries.map((r) =>
              toDate(r, ['startedAt', 'endedAt', 'createdAt', 'updatedAt']),
            ),
          )
          .run();
      }
      if (snapshot.reminders.length) {
        tx.insert(reminders)
          .values(snapshot.reminders.map((r) => toDate(r, ['remindAt', 'createdAt', 'updatedAt'])))
          .run();
      }
      if (snapshot.attachments.length) {
        tx.insert(attachments)
          .values(snapshot.attachments.map((r) => toDate(r, ['createdAt'])))
          .run();
      }
      if (snapshot.activityLog.length) {
        tx.insert(activityLog)
          .values(snapshot.activityLog.map((r) => toDate(r, ['createdAt'])))
          .run();
      }
      if (snapshot.savedFilters.length) {
        tx.insert(savedFilters)
          .values(snapshot.savedFilters.map((r) => toDate(r, ['createdAt', 'updatedAt'])))
          .run();
      }
    });

    return {
      counts: {
        projects: snapshot.projects.length,
        tasks: snapshot.tasks.length,
        tags: snapshot.tags.length,
        taskTags: snapshot.taskTags.length,
        timeEntries: snapshot.timeEntries.length,
        reminders: snapshot.reminders.length,
        activityLog: snapshot.activityLog.length,
        attachments: snapshot.attachments.length,
        savedFilters: snapshot.savedFilters.length,
      },
    };
  },
};
```

- [ ] **Step 4: Export it — modify `packages/core/src/services/index.ts`**

```ts
export * from './project-service';
export * from './tag-service';
export * from './task-service';
export * from './quick-add';
export * from './export-service';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/core test export-service`
Expected: PASS — export, round-trip, replace, and malformed-input cases green.

- [ ] **Step 6: Full core gates**

Run: `pnpm --filter @justdoit/core test && pnpm --filter @justdoit/core typecheck`
Expected: PASS — all core suites green, no type errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): add exportService (JSON snapshot import/export)"
```

---

## Task 7: Scaffold `@justdoit/api` (Hono app factory, error middleware, health)

**Files:**

- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/src/middleware/error.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/app.test.ts`
- Modify: `turbo.json` (root)
- Modify: `package.json` (root)

**Interfaces:**

- Consumes: `@justdoit/core` (`createDb`, `runMigrations`, `Db`, errors).
- Produces:
  - `createApp(db: Db): Hono` — the app factory used by tests and the bootstrap. Registers the error middleware and a `GET /health` route (`{ status: 'ok' }`); later tasks mount `/projects`, `/tags`, `/tasks`, `/search`, `/quick-add`, `/export`, `/import`.
  - `errorHandler(err, c)` — maps `NotFoundError → 404`, `ValidationError → 400`, `ConflictError → 409`, `ZodError → 400`, everything else → 500 (`{ error: string }`).
  - `apps/api/src/index.ts` — bootstrap: `createDb(process.env.JUSTDOIT_DB ?? 'justdoit.db')`, `runMigrations`, `serve` on `JUSTDOIT_API_PORT ?? 8787`.
  - Root `dev` turbo task (persistent) and root `pnpm dev` script.

- [ ] **Step 1: Write `apps/api/package.json`**

```json
{
  "name": "@justdoit/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.7",
    "@hono/zod-validator": "^0.4.2",
    "@justdoit/core": "workspace:*",
    "hono": "^4.6.14",
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

- [ ] **Step 2: Write `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "vitest.config.ts"]
}
```

- [ ] **Step 3: Write `apps/api/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Write `apps/api/src/middleware/error.ts`**

```ts
import type { Context } from 'hono';
import { ZodError } from 'zod';
import { NotFoundError, ValidationError, ConflictError } from '@justdoit/core';

export function errorHandler(err: Error, c: Context): Response {
  if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
  if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
  if (err instanceof ConflictError) return c.json({ error: err.message }, 409);
  if (err instanceof ZodError) {
    return c.json({ error: 'Validation failed', issues: err.issues }, 400);
  }
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
}
```

- [ ] **Step 5: Write `apps/api/src/routes/health.ts`**

```ts
import { Hono } from 'hono';

export function healthRoutes(): Hono {
  const r = new Hono();
  r.get('/health', (c) => c.json({ status: 'ok' }));
  return r;
}
```

- [ ] **Step 6: Write `apps/api/src/app.ts`**

```ts
import { Hono } from 'hono';
import type { Db } from '@justdoit/core';
import { errorHandler } from './middleware/error';
import { healthRoutes } from './routes/health';

export function createApp(db: Db): Hono {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/', healthRoutes());
  // Mounted in later tasks:
  // app.route('/projects', projectRoutes(db));
  // app.route('/tags', tagRoutes(db));
  // app.route('/tasks', taskRoutes(db));
  // app.route('/', searchRoutes(db));
  // app.route('/', quickAddRoutes(db));
  // app.route('/', transferRoutes(db));
  void db;
  return app;
}
```

- [ ] **Step 7: Write `apps/api/src/index.ts`**

```ts
import { serve } from '@hono/node-server';
import { createDb, runMigrations } from '@justdoit/core';
import { createApp } from './app';

const dbUrl = process.env.JUSTDOIT_DB ?? 'justdoit.db';
const { db } = createDb(dbUrl);
runMigrations(db);

const app = createApp(db);
const port = Number(process.env.JUSTDOIT_API_PORT ?? 8787);

serve({ fetch: app.fetch, port });
console.log(`justdoit API listening on http://localhost:${port} (db: ${dbUrl})`);
```

- [ ] **Step 8: Write the app test — `apps/api/src/app.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createDb, runMigrations, type Db } from '@justdoit/core';
import { createApp } from './app';

function appWithDb(): ReturnType<typeof createApp> {
  const { db }: { db: Db } = createDb(':memory:');
  runMigrations(db);
  return createApp(db);
}

describe('api app', () => {
  it('responds to GET /health', async () => {
    const app = appWithDb();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('returns 404 JSON for an unknown route', async () => {
    const app = appWithDb();
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 9: Update `turbo.json` (add a persistent `dev` task)**

Replace the file contents with:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "typecheck": {},
    "test": {},
    "dev": { "cache": false, "persistent": true }
  }
}
```

- [ ] **Step 10: Add a root `dev` script — modify root `package.json`**

Add to the `"scripts"` block (keep the existing scripts):

```json
"dev": "turbo dev"
```

- [ ] **Step 11: Install the new app's dependencies**

Run: `pnpm install`
Expected: installs `hono`, `@hono/node-server`, `@hono/zod-validator`, `tsx`; links `@justdoit/core` via `workspace:*`. Completes without error.

- [ ] **Step 12: Run the app test to verify it passes**

Run: `pnpm --filter @justdoit/api test`
Expected: PASS — `/health` returns 200 `{ status: 'ok' }`; unknown route returns 404.

- [ ] **Step 13: Typecheck**

Run: `pnpm --filter @justdoit/api typecheck`
Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat(api): scaffold Hono app factory with error middleware and health route"
```

---

## Task 8: REST routes — projects + tags

**Files:**

- Create: `apps/api/src/routes/projects.ts`
- Create: `apps/api/src/routes/tags.ts`
- Create: `apps/api/src/routes/projects.test.ts`
- Create: `apps/api/src/routes/tags.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**

- Consumes: `projectService`, `tagService`, `createProjectSchema`/`updateProjectSchema`, `createTagSchema`/`updateTagSchema`.
- Produces:
  - `projectRoutes(db: Db): Hono` mounted at `/projects`:
    - `GET /` (optional `?archived=true|false`), `POST /` (201), `GET /:id`, `PATCH /:id`, `DELETE /:id` (204).
  - `tagRoutes(db: Db): Hono` mounted at `/tags`:
    - `GET /`, `POST /` (201), `GET /:id`, `PATCH /:id`, `DELETE /:id` (204).

- [ ] **Step 1: Write the failing tests**

`apps/api/src/routes/projects.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createDb, runMigrations } from '@justdoit/core';
import { createApp } from '../app';

function app() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return createApp(db);
}

describe('projects routes', () => {
  it('creates, reads, lists, updates, deletes a project', async () => {
    const a = app();
    const created = await a.request('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Work' }),
    });
    expect(created.status).toBe(201);
    const project = await created.json();
    expect(project.name).toBe('Work');

    expect((await a.request('/projects')).status).toBe(200);
    expect((await a.request(`/projects/${project.id}`)).status).toBe(200);

    const patched = await a.request(`/projects/${project.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Work2' }),
    });
    expect((await patched.json()).name).toBe('Work2');

    const del = await a.request(`/projects/${project.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect((await a.request(`/projects/${project.id}`)).status).toBe(404);
  });

  it('rejects an invalid create body with 400', async () => {
    const res = await app().request('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
  });
});
```

`apps/api/src/routes/tags.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createDb, runMigrations } from '@justdoit/core';
import { createApp } from '../app';

function app() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return createApp(db);
}

describe('tags routes', () => {
  it('creates a tag and returns 409 on duplicate name', async () => {
    const a = app();
    const first = await a.request('/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'errands' }),
    });
    expect(first.status).toBe(201);

    const dup = await a.request('/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'errands' }),
    });
    expect(dup.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @justdoit/api test projects tags`
Expected: FAIL — routes not mounted; `/projects` returns 404.

- [ ] **Step 3: Write `apps/api/src/routes/projects.ts`**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { projectService, createProjectSchema, updateProjectSchema, type Db } from '@justdoit/core';

export function projectRoutes(db: Db): Hono {
  const r = new Hono();

  r.get('/', (c) => {
    const archived = c.req.query('archived');
    const opts = archived === undefined ? {} : { archived: archived === 'true' };
    return c.json(projectService.list(db, opts));
  });

  r.post('/', zValidator('json', createProjectSchema), (c) =>
    c.json(projectService.create(db, c.req.valid('json')), 201),
  );

  r.get('/:id', (c) => c.json(projectService.get(db, c.req.param('id'))));

  r.patch('/:id', zValidator('json', updateProjectSchema), (c) =>
    c.json(projectService.update(db, c.req.param('id'), c.req.valid('json'))),
  );

  r.delete('/:id', (c) => {
    projectService.remove(db, c.req.param('id'));
    return c.body(null, 204);
  });

  return r;
}
```

- [ ] **Step 4: Write `apps/api/src/routes/tags.ts`**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { tagService, createTagSchema, updateTagSchema, type Db } from '@justdoit/core';

export function tagRoutes(db: Db): Hono {
  const r = new Hono();

  r.get('/', (c) => c.json(tagService.list(db)));

  r.post('/', zValidator('json', createTagSchema), (c) =>
    c.json(tagService.create(db, c.req.valid('json')), 201),
  );

  r.get('/:id', (c) => c.json(tagService.get(db, c.req.param('id'))));

  r.patch('/:id', zValidator('json', updateTagSchema), (c) =>
    c.json(tagService.update(db, c.req.param('id'), c.req.valid('json'))),
  );

  r.delete('/:id', (c) => {
    tagService.remove(db, c.req.param('id'));
    return c.body(null, 204);
  });

  return r;
}
```

- [ ] **Step 5: Mount them — modify `apps/api/src/app.ts`**

Add the imports and mount lines (replace the corresponding commented placeholders):

```ts
import { projectRoutes } from './routes/projects';
import { tagRoutes } from './routes/tags';
```

```ts
app.route('/projects', projectRoutes(db));
app.route('/tags', tagRoutes(db));
```

Remove the now-unnecessary `void db;` line.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @justdoit/api test projects tags`
Expected: PASS — CRUD works, invalid body → 400, duplicate tag → 409.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @justdoit/api typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api): add /projects and /tags routes"
```

---

## Task 9: REST routes — tasks (+ status, complete, subtasks) and search

**Files:**

- Create: `apps/api/src/routes/tasks.ts`
- Create: `apps/api/src/routes/search.ts`
- Create: `apps/api/src/routes/tasks.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**

- Consumes: `taskService`, `TaskListFilters`, `createTaskSchema`/`updateTaskSchema`/`setStatusSchema`, `TaskStatus`/`TaskPriority`.
- Produces:
  - `taskRoutes(db: Db): Hono` mounted at `/tasks`:
    - `GET /` with query filters (`status`, `project_id`, `tag_id`, `priority`, `parent_task_id`, `archived`, `search`); `project_id=none`/`parent_task_id=none` → `null` (Inbox/top-level).
    - `POST /` (201), `GET /:id`, `PATCH /:id`, `DELETE /:id` (204).
    - `PATCH /:id/status` (body `{ status }`), `POST /:id/complete`.
    - `GET /:id/subtasks`, `POST /:id/subtasks` (201).
  - `searchRoutes(db: Db): Hono` mounted at `/`:
    - `GET /search?q=` → `taskService.list(db, { search: q })`; missing `q` → `400` (`ValidationError`).

- [ ] **Step 1: Write the failing test — `apps/api/src/routes/tasks.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createDb, runMigrations } from '@justdoit/core';
import { createApp } from '../app';

function app() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return createApp(db);
}

async function createTask(a: ReturnType<typeof createApp>, body: unknown) {
  const res = await a.request('/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, task: res.status < 300 ? await res.json() : undefined };
}

describe('tasks routes', () => {
  it('creates a task and reads it back', async () => {
    const a = app();
    const { res, task } = await createTask(a, { title: 'Write plan' });
    expect(res.status).toBe(201);
    expect(task.status).toBe('todo');
    expect((await a.request(`/tasks/${task.id}`)).status).toBe(200);
  });

  it('changes status and completes a task', async () => {
    const a = app();
    const { task } = await createTask(a, { title: 'x' });

    const statusRes = await a.request(`/tasks/${task.id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });
    expect((await statusRes.json()).status).toBe('in_progress');

    const done = await a.request(`/tasks/${task.id}/complete`, { method: 'POST' });
    const doneBody = await done.json();
    expect(doneBody.status).toBe('done');
    expect(doneBody.completedAt).not.toBeNull();
  });

  it('adds and lists subtasks', async () => {
    const a = app();
    const { task } = await createTask(a, { title: 'parent' });
    const sub = await a.request(`/tasks/${task.id}/subtasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'child' }),
    });
    expect(sub.status).toBe(201);
    const list = await (await a.request(`/tasks/${task.id}/subtasks`)).json();
    expect(list.map((t: { title: string }) => t.title)).toEqual(['child']);
  });

  it('filters via query params', async () => {
    const a = app();
    await createTask(a, { title: 'a', priority: 'p1' });
    await createTask(a, { title: 'b' });
    const p1 = await (await a.request('/tasks?priority=p1')).json();
    expect(p1).toHaveLength(1);
    const inbox = await (await a.request('/tasks?project_id=none')).json();
    expect(inbox).toHaveLength(2);
  });

  it('searches via GET /search?q=', async () => {
    const a = app();
    await createTask(a, { title: 'buy milk' });
    await createTask(a, { title: 'call bank' });
    const hits = await (await a.request('/search?q=milk')).json();
    expect(hits.map((t: { title: string }) => t.title)).toEqual(['buy milk']);
    expect((await a.request('/search')).status).toBe(400);
  });

  it('returns 404 for a missing task', async () => {
    expect((await app().request('/tasks/nope')).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/api test tasks`
Expected: FAIL — `/tasks` not mounted (404).

- [ ] **Step 3: Write `apps/api/src/routes/tasks.ts`**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  taskService,
  createTaskSchema,
  updateTaskSchema,
  setStatusSchema,
  type Db,
  type TaskListFilters,
  type TaskStatus,
  type TaskPriority,
} from '@justdoit/core';

function parseFilters(query: Record<string, string>): TaskListFilters {
  const filters: TaskListFilters = {};
  if (query.status) filters.status = query.status as TaskStatus;
  if (query.priority) filters.priority = query.priority as TaskPriority;
  if (query.tag_id) filters.tagId = query.tag_id;
  if (query.search) filters.search = query.search;
  if (query.project_id !== undefined) {
    filters.projectId = query.project_id === 'none' ? null : query.project_id;
  }
  if (query.parent_task_id !== undefined) {
    filters.parentTaskId = query.parent_task_id === 'none' ? null : query.parent_task_id;
  }
  if (query.archived !== undefined) filters.archived = query.archived === 'true';
  return filters;
}

export function taskRoutes(db: Db): Hono {
  const r = new Hono();

  r.get('/', (c) => c.json(taskService.list(db, parseFilters(c.req.query()))));

  r.post('/', zValidator('json', createTaskSchema), (c) =>
    c.json(taskService.create(db, c.req.valid('json')), 201),
  );

  r.get('/:id', (c) => c.json(taskService.get(db, c.req.param('id'))));

  r.patch('/:id', zValidator('json', updateTaskSchema), (c) =>
    c.json(taskService.update(db, c.req.param('id'), c.req.valid('json'))),
  );

  r.delete('/:id', (c) => {
    taskService.remove(db, c.req.param('id'));
    return c.body(null, 204);
  });

  r.patch('/:id/status', zValidator('json', setStatusSchema), (c) =>
    c.json(taskService.setStatus(db, c.req.param('id'), c.req.valid('json').status)),
  );

  r.post('/:id/complete', (c) => c.json(taskService.complete(db, c.req.param('id'))));

  r.get('/:id/subtasks', (c) => c.json(taskService.listSubtasks(db, c.req.param('id'))));

  r.post('/:id/subtasks', zValidator('json', createTaskSchema), (c) =>
    c.json(taskService.addSubtask(db, c.req.param('id'), c.req.valid('json')), 201),
  );

  return r;
}
```

- [ ] **Step 4: Write `apps/api/src/routes/search.ts`**

```ts
import { Hono } from 'hono';
import { taskService, ValidationError, type Db } from '@justdoit/core';

export function searchRoutes(db: Db): Hono {
  const r = new Hono();
  r.get('/search', (c) => {
    const q = c.req.query('q');
    if (!q) throw new ValidationError('Missing required query parameter: q');
    return c.json(taskService.list(db, { search: q }));
  });
  return r;
}
```

- [ ] **Step 5: Mount them — modify `apps/api/src/app.ts`**

Add imports:

```ts
import { taskRoutes } from './routes/tasks';
import { searchRoutes } from './routes/search';
```

Mount (order: mount `/tasks` and the root-level `search`):

```ts
app.route('/tasks', taskRoutes(db));
app.route('/', searchRoutes(db));
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/api test tasks`
Expected: PASS — create/read, status/complete, subtasks, filters, search, and 404 all green.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @justdoit/api typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api): add /tasks routes (status, complete, subtasks) and /search"
```

---

## Task 10: REST routes — quick-add + export/import, and final gates

**Files:**

- Create: `apps/api/src/routes/quick-add.ts`
- Create: `apps/api/src/routes/transfer.ts`
- Create: `apps/api/src/routes/transfer.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**

- Consumes: `quickAddService`, `exportService`, `quickAddSchema`.
- Produces:
  - `quickAddRoutes(db: Db): Hono` mounted at `/`:
    - `POST /quick-add` (body `{ text }`) → created `Task` (201). Uses the server clock (`new Date()`).
  - `transferRoutes(db: Db): Hono` mounted at `/`:
    - `GET /export` → `Snapshot` JSON.
    - `POST /import` (body = a `Snapshot`) → `ImportResult` (`{ counts }`); malformed → 400.

- [ ] **Step 1: Write the failing test — `apps/api/src/routes/transfer.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createDb, runMigrations } from '@justdoit/core';
import { createApp } from '../app';

function app() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return createApp(db);
}

describe('quick-add + transfer routes', () => {
  it('POST /quick-add creates a task with a tag', async () => {
    const a = app();
    const res = await a.request('/quick-add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'buy milk #errands p1' }),
    });
    expect(res.status).toBe(201);
    const task = await res.json();
    expect(task.title).toBe('buy milk');
    expect(task.priority).toBe('p1');
  });

  it('POST /quick-add rejects empty text with 400', async () => {
    const res = await app().request('/quick-add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('GET /export then POST /import round-trips into a fresh server', async () => {
    const source = app();
    await source.request('/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'seed' }),
    });
    const snapshot = await (await source.request('/export')).json();

    const target = app();
    const imported = await target.request('/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    expect(imported.status).toBe(200);
    expect((await imported.json()).counts.tasks).toBe(1);

    const tasks = await (await target.request('/tasks')).json();
    expect(tasks.map((t: { title: string }) => t.title)).toEqual(['seed']);
  });

  it('POST /import rejects a malformed snapshot with 400', async () => {
    const res = await app().request('/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/api test transfer`
Expected: FAIL — `/quick-add`, `/export`, `/import` not mounted.

- [ ] **Step 3: Write `apps/api/src/routes/quick-add.ts`**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { quickAddService, quickAddSchema, type Db } from '@justdoit/core';

export function quickAddRoutes(db: Db): Hono {
  const r = new Hono();
  r.post('/quick-add', zValidator('json', quickAddSchema), (c) =>
    c.json(quickAddService.create(db, c.req.valid('json').text), 201),
  );
  return r;
}
```

- [ ] **Step 4: Write `apps/api/src/routes/transfer.ts`**

```ts
import { Hono } from 'hono';
import { exportService, type Db, type Snapshot } from '@justdoit/core';

export function transferRoutes(db: Db): Hono {
  const r = new Hono();

  r.get('/export', (c) => c.json(exportService.exportSnapshot(db)));

  r.post('/import', async (c) => {
    const snapshot = (await c.req.json()) as Snapshot;
    return c.json(exportService.importSnapshot(db, snapshot));
  });

  return r;
}
```

- [ ] **Step 5: Mount them — modify `apps/api/src/app.ts`**

Add imports:

```ts
import { quickAddRoutes } from './routes/quick-add';
import { transferRoutes } from './routes/transfer';
```

Mount:

```ts
app.route('/', quickAddRoutes(db));
app.route('/', transferRoutes(db));
```

The final `createApp` mounts, in order: `healthRoutes()`, `/projects`, `/tags`, `/tasks`, root `searchRoutes`, root `quickAddRoutes`, root `transferRoutes`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/api test transfer`
Expected: PASS — quick-add creates a task, empty text → 400, export/import round-trips, malformed import → 400.

- [ ] **Step 7: Full workspace gates**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: all PASS (core + api suites green, no type/lint/format errors).

- [ ] **Step 8: Smoke-test the running server (optional but recommended)**

Run: `JUSTDOIT_DB=:memory: pnpm --filter @justdoit/api start &` then, after it logs "listening", `curl -s localhost:8787/health`
Expected: `{"status":"ok"}`. Stop the background server afterward.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(api): add /quick-add and /export + /import routes"
```

---

## Phase 1 Definition of Done

- `pnpm test` passes: every core service (`projectService`, `tagService`, `taskService`, `quickAddService`, `exportService`) is unit-tested against in-memory SQLite, and `@justdoit/api` integration tests hit every route through `app.request`.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all pass across `@justdoit/core` and `@justdoit/api`.
- All business logic lives in `packages/core/src/services/*`; Zod schemas live once in `packages/core/src/schemas/*` and are reused by the REST layer. `apps/api` contains no queries or business rules.
- Core errors map to HTTP status: `NotFoundError → 404`, `ValidationError → 400`, `ConflictError → 409`, `ZodError → 400`.
- The REST surface implemented: `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`; `GET/POST /tags`, `GET/PATCH/DELETE /tags/:id`; `GET/POST /tasks`, `GET/PATCH/DELETE /tasks/:id`, `PATCH /tasks/:id/status`, `POST /tasks/:id/complete`, `GET/POST /tasks/:id/subtasks`; `GET /search?q=`; `POST /quick-add`; `GET /export`, `POST /import`; `GET /health`.
- Subtasks are enforced one level deep; `done`/`cancelled` set `completed_at`, other statuses clear it; task list filtering works for status, project (incl. Inbox), tag, priority, parent, archived, and free-text.
- The API server boots from `createDb(process.env.JUSTDOIT_DB ?? 'justdoit.db')`, runs migrations, and serves on `JUSTDOIT_API_PORT ?? 8787` via `tsx`; `pnpm dev` runs it through Turborepo's persistent `dev` task.

## Notes for later phases

- **Time tracking (Phase 2)** adds `timeEntryService` + `/tasks/:id/timer/start|stop`, `/time-entries`, `/reports/time`. `exportService`'s `Snapshot` already round-trips `timeEntries`, so no snapshot change is needed — just fill the array.
- **Scheduling (Phase 3)** adds due/recurrence handling and reminders. Recurrence "spawn next occurrence" is triggered inside `taskService.complete` (Phase 3 is the source of truth: `complete` marks the task done, then spawns the next occurrence if the task is recurring), which is why `complete` already takes a trailing optional `now?: Date`. `reminders` are already in the snapshot.
- **MCP (Phase 4)** consumes the exact same services and Zod schemas from `@justdoit/core`; MCP tools (`create_task`, `quick_add`, `list_tasks`, …) are thin wrappers over `taskService`/`quickAddService`/`projectService`/`tagService` — no logic duplication.
- **quick-add parser** is intentionally dependency-light and clock-injectable (`parseQuickAdd(text, now)`). If richer NL date parsing is wanted later (e.g. "in 3 days", "next month"), swap the internal `computeDueAt`/`parseTime` helpers without changing the `QuickAddParsed` contract or the `/quick-add` route.
- **Activity log** (`activityLog` table) is present and round-trips through export, but is not yet written to by services. Phase 6 wires an audit trail; a good approach is a small `activityService.record(db, ...)` called from within `taskService` mutations.
- **Auth** (`X-API-Key`) is deferred to Phase 4; `createApp(db)` is the single place to add an auth middleware before the route mounts when it lands.
