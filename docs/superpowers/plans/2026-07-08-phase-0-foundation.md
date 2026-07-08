# Phase 0: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `justdoit` monorepo with a shared `core` package that defines the complete database schema and can bootstrap a migrated SQLite database, proven by a passing Vitest round-trip test.

**Architecture:** pnpm workspace + Turborepo monorepo. `packages/core` owns the Drizzle ORM schema (all tables), the SQLite client factory, and migration runner. Later phases add `apps/api`, `apps/mcp`, `apps/web` as thin adapters over `core`. In dev, packages consume `core` directly from TypeScript source (no build step yet); production bundling is deferred to the phases that need it.

**Tech Stack:** TypeScript 5.7 (strict), pnpm 10 workspaces, Turborepo 2, Drizzle ORM + `better-sqlite3`, Drizzle Kit (migrations), Vitest 3, ESLint 9 (flat config) + Prettier 3, Zod 3.

## Global Constraints

- Node `>=22`; pnpm `10.4.1` (pin via `packageManager`). Verbatim.
- Package names are scoped `@justdoit/*`; the core package is `@justdoit/core`. Verbatim.
- All packages are ESM (`"type": "module"`).
- `better-sqlite3` is a native module — pnpm 10 blocks its build script by default. Root `package.json` MUST include `"pnpm": { "onlyBuiltDependencies": ["better-sqlite3"] }`. Verbatim.
- TypeScript config: `moduleResolution: "Bundler"`, `strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`. Verbatim.
- SQLite column conventions: primary keys are `text` UUIDs (`crypto.randomUUID()`); timestamps are `integer` with `{ mode: 'timestamp_ms' }`; booleans are `integer` with `{ mode: 'boolean' }`.
- Task status enum: `backlog | todo | in_progress | blocked | done | cancelled`. Priority enum: `p0 | p1 | p2 | p3`. Time-entry source enum: `timer | manual`. Verbatim.

---

## File Structure

```
justdoit/
├── package.json                 # root: workspace, scripts, tooling devDeps, pnpm build allowlist
├── pnpm-workspace.yaml          # packages/* and apps/*
├── turbo.json                   # typecheck + test pipelines
├── tsconfig.base.json           # shared strict TS config
├── eslint.config.js             # flat ESLint config (root, covers all packages)
├── .prettierrc.json             # Prettier config
├── .prettierignore
├── .gitignore
└── packages/
    └── core/
        ├── package.json         # @justdoit/core, deps, scripts
        ├── tsconfig.json        # extends base
        ├── vitest.config.ts
        ├── drizzle.config.ts    # Drizzle Kit config
        ├── drizzle/             # GENERATED migrations (0000_*.sql, meta/)
        └── src/
            ├── index.ts         # package entry: re-exports ./db
            └── db/
                ├── schema.ts    # ALL tables + enums + inferred types
                ├── client.ts    # createDb() + runMigrations()
                ├── client.test.ts
                └── index.ts     # re-exports schema + client
```

---

## Task 1: Monorepo scaffold & tooling

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Create: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: a working pnpm workspace with root scripts `pnpm typecheck` (→ `turbo typecheck`), `pnpm test` (→ `turbo test`), `pnpm lint` (→ `eslint .`), `pnpm format` / `pnpm format:check`. The `@justdoit/core` package (Task 2) plugs into `packages/*`. Root `pnpm.onlyBuiltDependencies` allows `better-sqlite3` to build.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "justdoit",
  "private": true,
  "packageManager": "pnpm@10.4.1",
  "engines": { "node": ">=22" },
  "scripts": {
    "typecheck": "turbo typecheck",
    "test": "turbo test",
    "lint": "eslint .",
    "format": "prettier --write .",
    "format:check": "prettier --check ."
  },
  "pnpm": {
    "onlyBuiltDependencies": ["better-sqlite3"]
  },
  "devDependencies": {
    "@eslint/js": "^9.17.0",
    "eslint": "^9.17.0",
    "prettier": "^3.4.2",
    "turbo": "^2.3.3",
    "typescript": "^5.7.3",
    "typescript-eslint": "^8.19.0"
  }
}
```

- [ ] **Step 2: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - packages/*
  - apps/*
```

- [ ] **Step 3: Write `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "typecheck": {},
    "test": {}
  }
}
```

- [ ] **Step 4: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "types": ["node"]
  }
}
```

- [ ] **Step 5: Write `eslint.config.js`**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/drizzle/**', '**/.turbo/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
```

- [ ] **Step 6: Write `.prettierrc.json`**

```json
{
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

- [ ] **Step 7: Write `.prettierignore`**

```
node_modules
dist
.turbo
packages/*/drizzle
pnpm-lock.yaml
```

- [ ] **Step 8: Write `.gitignore`**

```
node_modules/
dist/
.turbo/
*.tsbuildinfo
*.db
*.db-shm
*.db-wal
.DS_Store
.env
.env.local
```

- [ ] **Step 9: Install dependencies**

Run: `pnpm install`
Expected: completes without error; creates `pnpm-lock.yaml` and `node_modules/`. No warning about ignored build scripts for `better-sqlite3` (that package is added in Task 2, but the allowlist is already in place).

- [ ] **Step 10: Verify tooling runs**

Run: `pnpm format:check`
Expected: PASS — "All matched files use Prettier code style!" (or reports only files you just wrote; if it complains, run `pnpm format` then re-check).

Run: `pnpm lint`
Expected: exits 0 — no TS/JS source files to lint yet besides `eslint.config.js`, which passes.

Run: `pnpm typecheck`
Expected: turbo reports no `typecheck` tasks to run (no packages yet) and exits 0.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm+turbo monorepo with tooling"
```

---

## Task 2: Core package skeleton & Drizzle schema

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/drizzle.config.ts`
- Create: `packages/core/src/db/schema.ts`
- Create: `packages/core/src/db/index.ts`
- Create: `packages/core/src/index.ts`
- Generated: `packages/core/drizzle/0000_*.sql` (+ `drizzle/meta/`)

**Interfaces:**
- Consumes: the workspace + tooling from Task 1.
- Produces:
  - Package `@justdoit/core` resolvable in the workspace, entry `./src/index.ts`.
  - `schema.ts` exports the Drizzle tables: `projects`, `tasks`, `tags`, `taskTags`, `timeEntries`, `reminders`, `activityLog`, `attachments`, `savedFilters`.
  - Exported enum tuples: `TASK_STATUSES`, `TASK_PRIORITIES`, `TIME_ENTRY_SOURCES`, and matching types `TaskStatus`, `TaskPriority`, `TimeEntrySource`.
  - Inferred row types: `Project`/`NewProject`, `Task`/`NewTask`, `Tag`/`NewTag`, `TimeEntry`/`NewTimeEntry`.
  - A generated SQL migration under `drizzle/` that creates every table.
  - npm scripts on `@justdoit/core`: `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `db:generate` (`drizzle-kit generate`), `db:migrate` (`drizzle-kit migrate`).

- [ ] **Step 1: Write `packages/core/package.json`**

```json
{
  "name": "@justdoit/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.0",
    "drizzle-orm": "^0.38.3",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.0",
    "drizzle-kit": "^0.30.1",
    "typescript": "^5.7.3",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Write `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "drizzle.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Write `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Write `packages/core/drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: 'justdoit.db',
  },
});
```

- [ ] **Step 5: Write `packages/core/src/db/schema.ts`**

```ts
import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

export const TASK_STATUSES = [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['p0', 'p1', 'p2', 'p3'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TIME_ENTRY_SOURCES = ['timer', 'manual'] as const;
export type TimeEntrySource = (typeof TIME_ENTRY_SOURCES)[number];

const pk = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date());

export const projects = sqliteTable('projects', {
  id: pk(),
  name: text('name').notNull(),
  color: text('color'),
  icon: text('icon'),
  description: text('description'),
  position: real('position').notNull().default(0),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const tasks = sqliteTable(
  'tasks',
  {
    id: pk(),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status', { enum: TASK_STATUSES }).notNull().default('todo'),
    priority: text('priority', { enum: TASK_PRIORITIES }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    parentTaskId: text('parent_task_id').references((): AnySQLiteColumn => tasks.id, {
      onDelete: 'cascade',
    }),
    position: real('position').notNull().default(0),
    dueAt: integer('due_at', { mode: 'timestamp_ms' }),
    startAt: integer('start_at', { mode: 'timestamp_ms' }),
    estimateMinutes: integer('estimate_minutes'),
    recurrence: text('recurrence'),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tasks_project_idx').on(t.projectId),
    index('tasks_status_idx').on(t.status),
    index('tasks_parent_idx').on(t.parentTaskId),
  ],
);

export const tags = sqliteTable('tags', {
  id: pk(),
  name: text('name').notNull().unique(),
  color: text('color'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const taskTags = sqliteTable(
  'task_tags',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.tagId] })],
);

export const timeEntries = sqliteTable(
  'time_entries',
  {
    id: pk(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
    durationSeconds: integer('duration_seconds'),
    note: text('note'),
    source: text('source', { enum: TIME_ENTRY_SOURCES }).notNull().default('timer'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('time_entries_task_idx').on(t.taskId)],
);

export const reminders = sqliteTable(
  'reminders',
  {
    id: pk(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    remindAt: integer('remind_at', { mode: 'timestamp_ms' }).notNull(),
    delivered: integer('delivered', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('reminders_remind_at_idx').on(t.remindAt)],
);

export const activityLog = sqliteTable(
  'activity_log',
  {
    id: pk(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('activity_entity_idx').on(t.entityType, t.entityId)],
);

export const attachments = sqliteTable(
  'attachments',
  {
    id: pk(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    path: text('path').notNull(),
    mime: text('mime'),
    size: integer('size'),
    createdAt: createdAt(),
  },
  (t) => [index('attachments_task_idx').on(t.taskId)],
);

export const savedFilters = sqliteTable('saved_filters', {
  id: pk(),
  name: text('name').notNull(),
  query: text('query', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type NewTimeEntry = typeof timeEntries.$inferInsert;
```

- [ ] **Step 6: Write `packages/core/src/db/index.ts`**

```ts
export * from './schema';
```

- [ ] **Step 7: Write `packages/core/src/index.ts`**

```ts
export * from './db';
```

- [ ] **Step 8: Install the new package's dependencies**

Run: `pnpm install`
Expected: installs `better-sqlite3`, `drizzle-orm`, `drizzle-kit`, `vitest`, etc. `better-sqlite3` build script runs successfully (allowed via root `onlyBuiltDependencies`). No "ignored build scripts" warning for `better-sqlite3`.

- [ ] **Step 9: Typecheck the schema**

Run: `pnpm --filter @justdoit/core typecheck`
Expected: PASS — no type errors.

- [ ] **Step 10: Generate the initial migration**

Run: `pnpm --filter @justdoit/core db:generate`
Expected: creates `packages/core/drizzle/0000_*.sql` and `packages/core/drizzle/meta/`. Console reports the tables/indexes it created.

- [ ] **Step 11: Verify the migration created every table**

Run: `grep -c "CREATE TABLE" packages/core/drizzle/0000_*.sql`
Expected: `9` (projects, tasks, tags, task_tags, time_entries, reminders, activity_log, attachments, saved_filters).

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(core): add Drizzle schema and initial migration"
```

---

## Task 3: Database bootstrap (client + migration runner)

**Files:**
- Create: `packages/core/src/db/client.ts`
- Create: `packages/core/src/db/client.test.ts`
- Modify: `packages/core/src/db/index.ts` (add client export)

**Interfaces:**
- Consumes: `schema.ts` tables (`projects`, `tasks`) and the generated `drizzle/` migrations from Task 2.
- Produces:
  - `type Db = BetterSQLite3Database<typeof schema>` — the typed Drizzle instance used by every later adapter (api, mcp).
  - `interface CreateDbResult { db: Db; sqlite: Database.Database }`.
  - `createDb(url?: string): CreateDbResult` — opens a SQLite database (default `'justdoit.db'`, pass `':memory:'` for tests), enables WAL + foreign keys, returns the Drizzle instance and raw handle.
  - `runMigrations(db: Db, migrationsFolder?: string): void` — applies the `drizzle/` migrations; default folder resolves to the package's `drizzle/` directory.

- [ ] **Step 1: Write the failing test — `packages/core/src/db/client.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, runMigrations } from './client';
import { projects, tasks } from './schema';

describe('database bootstrap', () => {
  it('applies migrations and round-trips a project and task', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);

    const [project] = db.insert(projects).values({ name: 'Inbox' }).returning().all();
    expect(project).toBeDefined();
    expect(project!.name).toBe('Inbox');
    expect(project!.id).toMatch(/[0-9a-f-]{36}/);

    const [task] = db
      .insert(tasks)
      .values({ title: 'Write the plan', projectId: project!.id, status: 'todo' })
      .returning()
      .all();
    expect(task!.title).toBe('Write the plan');
    expect(task!.status).toBe('todo');
    expect(task!.createdAt).toBeInstanceOf(Date);

    const found = db.select().from(tasks).where(eq(tasks.id, task!.id)).all();
    expect(found).toHaveLength(1);
  });

  it('defaults task status to todo', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const [task] = db.insert(tasks).values({ title: 'No status given' }).returning().all();
    expect(task!.status).toBe('todo');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/core test`
Expected: FAIL — cannot resolve `./client` / `createDb is not exported` (module does not exist yet).

- [ ] **Step 3: Write the implementation — `packages/core/src/db/client.ts`**

```ts
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

export interface CreateDbResult {
  db: Db;
  sqlite: Database.Database;
}

export function createDb(url = 'justdoit.db'): CreateDbResult {
  const sqlite = new Database(url);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

const DEFAULT_MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export function runMigrations(db: Db, migrationsFolder: string = DEFAULT_MIGRATIONS_DIR): void {
  migrate(db, { migrationsFolder });
}
```

- [ ] **Step 4: Add the client export — modify `packages/core/src/db/index.ts`**

Replace the file contents with:

```ts
export * from './schema';
export * from './client';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/core test`
Expected: PASS — both tests green.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @justdoit/core typecheck`
Expected: PASS — no type errors.

- [ ] **Step 7: Run the full workspace gates**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm format:check`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core): add SQLite client factory and migration runner"
```

---

## Phase 0 Definition of Done

- `pnpm install` succeeds and `better-sqlite3` builds without manual approval.
- `pnpm test` passes (`core` round-trip + default-status tests green).
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` all pass.
- `packages/core/drizzle/0000_*.sql` exists and creates all 9 tables.
- `@justdoit/core` exports the schema, inferred types, `createDb`, and `runMigrations` for later phases to consume.

## Notes for later phases

- Dev-time consumption of `core` is via TypeScript source (`main`/`exports` → `./src/index.ts`); `apps/api` and `apps/mcp` will run through `tsx`/Vitest. A production build step (e.g. `tsup`) is deferred to the phase that first ships a runnable binary.
- The file-backed DB path (`justdoit.db`) and its location will be made configurable (env var) when `apps/api` is introduced in Phase 1.
