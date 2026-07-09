# Phase 7a: Multitenancy in `core` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every user-owned row an owner and scope every `core` query to the acting user, so a request acting as user A can never read, mutate, or discover a row owned by user B (spec §2). Introduce `users` + `api_keys` tables, a `user_id` column on all eight user-owned tables, per-user tag uniqueness, a data-preserving migration that seeds a fixed `local-user` and backfills existing rows, a `Ctx` threaded through every service, a `userService`/`apiKeyService`, and a cross-tenant isolation test suite that is the security gate. The API and MCP adapters are updated minimally so the app still builds and runs in **local mode** (`local-user`); real key→user resolution is Phase 7b.

**Architecture:** `packages/core` owns tenancy. Every user-owned service method changes from `(db, …)` to `(ctx, …)` where `interface Ctx { db: Db; userId: string }`. Reads compose `userScope(table, ctx.userId)` (a centralized `eq(table.userId, userId)` predicate) with existing filters; inserts stamp `userId: ctx.userId`; by-id ops filter on `userId` so a foreign id yields `NotFound`; cross-entity references (`projectId`, `parentTaskId`, `tagId`, `taskId`) are validated to belong to `ctx.userId` before use. `users`/`api_keys` are *not* user-owned, so `userService`/`apiKeyService` take a bare `db` (plus an explicit `userId` argument where the operation is inherently per-user). In `apps/api` a **single Hono middleware** sets the per-request context as `c.set('ctx', { db, userId })` (readable as `c.var.ctx`), defaulting `userId` to `LOCAL_USER_ID` in 7a; every route handler reads `c.var.ctx` and passes it to `core`. (Phase 7b replaces only that middleware's identity resolution — the routes are untouched.) `apps/mcp` builds a `{ db, userId: LOCAL_USER_ID }` ctx in local mode.

**Tech Stack:** unchanged from Phases 0–6 — TypeScript 5.7 (strict), Drizzle ORM + `better-sqlite3`, Drizzle Kit, Vitest 3, Hono, Zod 3, `@modelcontextprotocol/sdk`.

## Global Constraints

- **Isolation invariant (spec §2) is the acceptance gate.** Enforced in `core`, proven by the isolation tests. Cross-tenant access returns `NotFoundError` (404), never another user's data.
- **Fixed local user:** `id = 'local-user'`. Exported as `LOCAL_USER_ID` from `@justdoit/core`. Local mode (the only mode in 7a) pins every request to it.
- **Owner column:** `user_id text NOT NULL` on `projects`, `tasks`, `tags`, `time_entries`, `reminders`, `activity_log`, `attachments`, `saved_filters`, each with an index and a declared FK → `users.id` `onDelete: cascade` in `schema.ts`.
- **Per-user tag uniqueness:** `tags.name` is unique **per user** (`unique(user_id, name)`), not global.
- **Transitional schema default (scaffolding):** the `user_id` column is declared with a temporary `.$defaultFn(() => LOCAL_USER_ID)` so every pre-existing `(db, …)` insert keeps compiling while services are converted one cluster at a time. **Task 16 removes this default**, after which the type system *forces* every insert to stamp `userId: ctx.userId` (hosted-mode safety). Do not skip Task 16.
- **SQLite ALTER limitation (documented, deliberate):** SQLite cannot `ALTER TABLE … ADD COLUMN` that is simultaneously `NOT NULL` (needs a non-NULL default) **and** carries a `REFERENCES` clause (needs a NULL default) while `PRAGMA foreign_keys=ON`. The 0001 migration therefore adds `user_id` as `NOT NULL DEFAULT 'local-user'` **without** an inline DB-level FK, and swaps the `tags` unique index in place (no table rebuild). Two harmless divergences result between `schema.ts` and the physical DB: (a) the DB column keeps a `DEFAULT 'local-user'`; (b) the DB lacks the `user_id` FK constraint. Neither affects the code-enforced §2 invariant (Drizzle never relies on DB FKs for query scoping). **Do not run `pnpm --filter @justdoit/core db:generate` after Task 1** — it would try to "reconcile" this drift by rebuilding tables. A squashed baseline that adds the physical FK via table rebuild is a Phase 7c cutover task.
- **Adapters stay lockstep:** converting a service changes its signature, so the *same task* updates that service's REST route(s), MCP tool(s), and every test that calls it. Task boundaries are always green (`pnpm typecheck && pnpm test` pass).
- **Clock convention unchanged:** injected as trailing positional `now?: Date`.

## File Structure (new/changed in 7a)

```
packages/core/
├── drizzle/
│   └── 0001_multitenancy.sql            # NEW — hand-authored migration + backfill
│   └── meta/                            # UPDATED journal + snapshot
└── src/
    ├── constants.ts                     # NEW — LOCAL_USER_ID
    ├── context.ts                       # NEW — Ctx, re-export LOCAL_USER_ID
    ├── scope.ts                         # NEW — userScope(table, userId)
    ├── db/schema.ts                     # CHANGED — users, api_keys, user_id cols, tag uniqueness
    ├── migration.test.ts                # NEW — backfill against a DB with pre-existing data
    ├── isolation.test.ts                # NEW — consolidated cross-tenant security-gate sweep
    ├── events/{bus.ts,emit.ts}          # CHANGED — DomainEvent.userId; emit(userId, …)
    ├── schemas/{user.ts,api-key.ts}     # NEW — Zod inputs
    ├── index.ts                         # CHANGED — export context, scope, constants, new services
    └── services/
        ├── user-service.ts (+test)      # NEW
        ├── api-key-service.ts (+test)   # NEW
        └── *-service.ts (+tests)        # CHANGED — (db,…) → (ctx,…), scoping, isolation tests
apps/api/src/
    ├── context.ts                       # NEW — AppEnv + setUserContext middleware (c.set('ctx', …))
    ├── app.ts                           # CHANGED — register setUserContext; seed local user; scheduler ctx
    └── routes/*.ts (+tests)             # CHANGED — read c.var.ctx (typed Hono<AppEnv>)
apps/mcp/src/
    └── tools/*.ts, resources.ts         # CHANGED — build local-user ctx, call services with ctx
```

---

## Task 1: Schema — users/api_keys tables, owner columns, per-user tag uniqueness, migration + backfill

**Files:**

- Create: `packages/core/src/constants.ts`
- Modify: `packages/core/src/db/schema.ts`
- Create: `packages/core/drizzle/0001_multitenancy.sql`
- Modify: `packages/core/drizzle/meta/_journal.json` (+ new snapshot under `meta/`)
- Create: `packages/core/src/migration.test.ts`
- Modify: `packages/core/src/index.ts` (export `constants`)

**Interfaces:**

- Consumes: existing `createDb`/`runMigrations`, the `0000_solid_molten_man` migration.
- Produces:
  - New tables `users` (`id`, `github_id` unique, `email`, `name`, `avatar_url`, `created_at`, `updated_at`) and `api_keys` (`id`, `user_id`→users, `name`, `token_hash` unique, `last_used_at`, `created_at`).
  - `user_id text NOT NULL` (+ index, + declared FK→users onDelete cascade, + transitional `$defaultFn(() => LOCAL_USER_ID)`) on all eight user-owned tables.
  - `tags` uniqueness `unique(user_id, name)` replacing the global `name` unique.
  - New inferred types `User`/`NewUser`, `ApiKey`/`NewApiKey`. Existing `Project`/`Task`/`Tag`/… now include `userId: string`.
  - Exported `LOCAL_USER_ID = 'local-user'`.
  - A migration that, applied to a DB already holding rows, creates the tables, seeds `local-user`, and backfills `user_id='local-user'` on every existing row.

- [ ] **Step 1: Write `packages/core/src/constants.ts`**

```ts
/** The fixed implicit owner used in local mode and to backfill pre-tenancy rows. */
export const LOCAL_USER_ID = 'local-user';
```

- [ ] **Step 2: Export it — modify `packages/core/src/index.ts`**

Add near the top (order does not matter):

```ts
export * from './constants';
```

- [ ] **Step 3: Edit `packages/core/src/db/schema.ts` — imports, owner helper, new tables**

Change the top import to add `unique` and import the constant:

```ts
import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
  unique,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { LOCAL_USER_ID } from '../constants';
```

Immediately **before** the `projects` table, define `users`, `api_keys`, and the shared owner-column helper:

```ts
export const users = sqliteTable('users', {
  id: pk(),
  githubId: text('github_id').unique(),
  email: text('email'),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: pk(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [index('api_keys_user_idx').on(t.userId)],
);

/**
 * Owner column for user-owned tables. The trailing `.$defaultFn` is TRANSITIONAL
 * scaffolding: it keeps every pre-tenancy `(db, …)` insert compiling while
 * services are converted to `(ctx, …)` one cluster at a time. Task 16 removes it
 * so the type system forces explicit `userId: ctx.userId` stamping. The declared
 * FK documents intent; the 0001 migration adds the physical column without the
 * DB-level FK (SQLite ALTER limitation — see plan Global Constraints).
 */
const ownerId = () =>
  text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .$defaultFn(() => LOCAL_USER_ID);
```

- [ ] **Step 4: Add `userId: ownerId()` + a user index to each user-owned table**

For `projects` add `userId: ownerId(),` to the columns object, and (projects had no extra-config callback) add one:

```ts
export const projects = sqliteTable(
  'projects',
  {
    id: pk(),
    userId: ownerId(),
    name: text('name').notNull(),
    color: text('color'),
    icon: text('icon'),
    description: text('description'),
    position: real('position').notNull().default(0),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('projects_user_idx').on(t.userId)],
);
```

For `tasks`, add `userId: ownerId(),` after `id: pk(),` and append `index('tasks_user_idx').on(t.userId)` to its existing config array.

For `tags`, add the owner column and replace the global `.unique()` on `name` with a composite unique + user index:

```ts
export const tags = sqliteTable(
  'tags',
  {
    id: pk(),
    userId: ownerId(),
    name: text('name').notNull(), // NOTE: `.unique()` removed — now composite below
    color: text('color'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('tags_user_id_name_unique').on(t.userId, t.name),
    index('tags_user_idx').on(t.userId),
  ],
);
```

For `timeEntries`, `reminders`, `activityLog`, `attachments`: add `userId: ownerId(),` after `id: pk(),` and append `index('<table>_user_idx').on(t.userId)` to each existing config array (`time_entries_user_idx`, `reminders_user_idx`, `activity_log_user_idx`, `attachments_user_idx`).

For `savedFilters` (no existing config callback), add the column and a callback:

```ts
export const savedFilters = sqliteTable(
  'saved_filters',
  {
    id: pk(),
    userId: ownerId(),
    name: text('name').notNull(),
    query: text('query', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('saved_filters_user_idx').on(t.userId)],
);
```

> `taskTags` is a pure join table (its rows are reachable only through owned `tasks`/`tags`); it gets **no** `user_id`. Isolation for tags-on-tasks is enforced by validating both endpoints belong to `ctx.userId` in `tagService.attach`.

- [ ] **Step 5: Add the new inferred types at the bottom of `schema.ts`**

```ts
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
```

- [ ] **Step 6: Typecheck the schema**

Run: `pnpm --filter @justdoit/core typecheck`
Expected: PASS. Existing service inserts still compile because `user_id` has a `$defaultFn` (so it is optional in `$inferInsert`).

- [ ] **Step 7: Hand-author the migration — `packages/core/drizzle/0001_multitenancy.sql`**

> Written by hand (not `db:generate`) so we control table order, the `local-user` seed, and the in-place `tags` unique-index swap. Statements are separated by `--> statement-breakpoint` (the format the better-sqlite3 migrator splits on).

```sql
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`github_id` text,
	`email` text,
	`name` text,
	`avatar_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_github_id_unique` ON `users` (`github_id`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_token_hash_unique` ON `api_keys` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_user_idx` ON `api_keys` (`user_id`);--> statement-breakpoint
INSERT INTO `users` (`id`, `github_id`, `email`, `name`, `avatar_url`, `created_at`, `updated_at`)
VALUES ('local-user', NULL, NULL, 'Local User', NULL, (strftime('%s','now') * 1000), (strftime('%s','now') * 1000));
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `user_id` text NOT NULL DEFAULT 'local-user';--> statement-breakpoint
CREATE INDEX `projects_user_idx` ON `projects` (`user_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `user_id` text NOT NULL DEFAULT 'local-user';--> statement-breakpoint
CREATE INDEX `tasks_user_idx` ON `tasks` (`user_id`);--> statement-breakpoint
ALTER TABLE `time_entries` ADD COLUMN `user_id` text NOT NULL DEFAULT 'local-user';--> statement-breakpoint
CREATE INDEX `time_entries_user_idx` ON `time_entries` (`user_id`);--> statement-breakpoint
ALTER TABLE `reminders` ADD COLUMN `user_id` text NOT NULL DEFAULT 'local-user';--> statement-breakpoint
CREATE INDEX `reminders_user_idx` ON `reminders` (`user_id`);--> statement-breakpoint
ALTER TABLE `activity_log` ADD COLUMN `user_id` text NOT NULL DEFAULT 'local-user';--> statement-breakpoint
CREATE INDEX `activity_log_user_idx` ON `activity_log` (`user_id`);--> statement-breakpoint
ALTER TABLE `attachments` ADD COLUMN `user_id` text NOT NULL DEFAULT 'local-user';--> statement-breakpoint
CREATE INDEX `attachments_user_idx` ON `attachments` (`user_id`);--> statement-breakpoint
ALTER TABLE `saved_filters` ADD COLUMN `user_id` text NOT NULL DEFAULT 'local-user';--> statement-breakpoint
CREATE INDEX `saved_filters_user_idx` ON `saved_filters` (`user_id`);--> statement-breakpoint
ALTER TABLE `tags` ADD COLUMN `user_id` text NOT NULL DEFAULT 'local-user';--> statement-breakpoint
DROP INDEX `tags_name_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `tags_user_id_name_unique` ON `tags` (`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `tags_user_idx` ON `tags` (`user_id`);
```

- [ ] **Step 8: Register the migration in the journal — `packages/core/drizzle/meta/_journal.json`**

Append a second entry so the migrator applies it after `0000`:

```json
{
  "version": "7",
  "dialect": "sqlite",
  "entries": [
    {
      "idx": 0,
      "version": "6",
      "when": 1783501468989,
      "tag": "0000_solid_molten_man",
      "breakpoints": true
    },
    {
      "idx": 1,
      "version": "6",
      "when": 1783587868989,
      "tag": "0001_multitenancy",
      "breakpoints": true
    }
  ]
}
```

Also copy `packages/core/drizzle/meta/0000_snapshot.json` to `0001_snapshot.json` (the migrator does not require it for `migrate()`, but keeping the folder well-formed avoids `db:generate` confusion later). If time-constrained, this snapshot copy is optional for green tests.

- [ ] **Step 9: Write the failing migration/backfill test — `packages/core/src/migration.test.ts`**

This drives the two SQL files directly against a raw handle that already holds legacy rows, proving the backfill (independent of the migrator's journal bookkeeping).

```ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const migration = (tag: string): string =>
  readFileSync(resolve(here, `../drizzle/${tag}.sql`), 'utf8').replaceAll('--> statement-breakpoint', '');

describe('0001 multitenancy migration', () => {
  it('creates the local user and backfills user_id on pre-existing rows', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');

    // Baseline schema (0000) + legacy data that predates tenancy.
    sqlite.exec(migration('0000_solid_molten_man'));
    sqlite.prepare(
      `INSERT INTO projects (id, name, position, archived, created_at, updated_at)
       VALUES ('p1', 'Legacy', 0, 0, 0, 0)`,
    ).run();
    sqlite.prepare(
      `INSERT INTO tasks (id, title, status, position, archived, created_at, updated_at)
       VALUES ('t1', 'Legacy task', 'todo', 0, 0, 0, 0)`,
    ).run();
    sqlite.prepare(
      `INSERT INTO tags (id, name, created_at, updated_at) VALUES ('g1', 'legacy', 0, 0)`,
    ).run();

    // Apply the tenancy migration.
    sqlite.exec(migration('0001_multitenancy'));

    // Local user exists.
    const u = sqlite.prepare(`SELECT id, name FROM users WHERE id = 'local-user'`).get() as
      | { id: string; name: string }
      | undefined;
    expect(u?.id).toBe('local-user');

    // Existing rows are backfilled.
    for (const table of ['projects', 'tasks', 'tags']) {
      const row = sqlite.prepare(`SELECT user_id FROM ${table} LIMIT 1`).get() as { user_id: string };
      expect(row.user_id).toBe('local-user');
    }

    // Per-user tag uniqueness: same name allowed for a different user.
    sqlite.prepare(
      `INSERT INTO users (id, created_at, updated_at) VALUES ('u2', 0, 0)`,
    ).run();
    expect(() =>
      sqlite.prepare(
        `INSERT INTO tags (id, user_id, name, created_at, updated_at) VALUES ('g2', 'u2', 'legacy', 0, 0)`,
      ).run(),
    ).not.toThrow();
    // …but a duplicate (user, name) is rejected.
    expect(() =>
      sqlite.prepare(
        `INSERT INTO tags (id, user_id, name, created_at, updated_at) VALUES ('g3', 'local-user', 'legacy', 0, 0)`,
      ).run(),
    ).toThrow();

    sqlite.close();
  });
});
```

- [ ] **Step 10: Run it (fails), then confirm it passes**

Run: `pnpm --filter @justdoit/core test migration`
Expected first run: FAIL if the SQL is malformed (fix `0001_multitenancy.sql` until green). Once the migration is correct: PASS.

- [ ] **Step 11: Confirm the full round-trip migrator still boots a fresh DB**

Run: `pnpm --filter @justdoit/core test client`
Expected: existing `db/client.test.ts` still PASS — `runMigrations` now applies `0000` then `0001` on a fresh `:memory:` DB. (Round-trip inserts omit `user_id`, which the schema `$defaultFn` fills with `local-user`.)

- [ ] **Step 12: Full core suite (baseline before conversions)**

Run: `pnpm --filter @justdoit/core test`
Expected: all currently-passing core tests still green (single-user, behavior unchanged) + the new migration test.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(core): add users/api_keys tables, user_id columns, per-user tag uniqueness + backfill migration"
```

---

## Task 2: `Ctx`, `userScope`, `userService`, `apiKeyService`

**Files:**

- Create: `packages/core/src/context.ts`
- Create: `packages/core/src/scope.ts`
- Create: `packages/core/src/schemas/user.ts`
- Create: `packages/core/src/schemas/api-key.ts`
- Create: `packages/core/src/services/user-service.ts` (+ `user-service.test.ts`)
- Create: `packages/core/src/services/api-key-service.ts` (+ `api-key-service.test.ts`)
- Modify: `packages/core/src/index.ts`, `packages/core/src/services/index.ts`, `packages/core/src/schemas/index.ts`

**Interfaces:**

- Consumes: `Db`, `users`/`apiKeys` tables, `LOCAL_USER_ID`, `NotFoundError`.
- Produces:
  - `interface Ctx { db: Db; userId: string }` (re-exports `LOCAL_USER_ID`).
  - `userScope(table: { userId: SQLiteColumn }, userId: string): SQL`.
  - `userService`: `create(db, input)`, `get(db, id)`, `getByGithubId(db, githubId)`, `upsertByGithubId(db, input)`, `ensureLocalUser(db)`.
  - `apiKeyService`: `create(db, userId, name, now?)`, `listForUser(db, userId)`, `revoke(db, userId, id)`, `resolveToken(db, rawToken, now?)`.

- [ ] **Step 1: Write `packages/core/src/context.ts`**

```ts
import type { Db } from './db';
export { LOCAL_USER_ID } from './constants';

/** Per-request tenant context. Every user-owned service method takes this. */
export interface Ctx {
  db: Db;
  userId: string;
}
```

- [ ] **Step 2: Write `packages/core/src/scope.ts`**

```ts
import { eq, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

/** Centralized owner predicate — every scoped read composes this to avoid drift. */
export function userScope(table: { userId: SQLiteColumn }, userId: string): SQL {
  return eq(table.userId, userId);
}
```

- [ ] **Step 3: Write the Zod inputs**

`packages/core/src/schemas/user.ts`:

```ts
import { z } from 'zod';

export const upsertGithubUserSchema = z.object({
  githubId: z.string().min(1),
  email: z.string().email().nullish(),
  name: z.string().nullish(),
  avatarUrl: z.string().url().nullish(),
});
export type UpsertGithubUserInput = z.infer<typeof upsertGithubUserSchema>;

export const createUserSchema = z.object({
  id: z.string().min(1).optional(),
  githubId: z.string().min(1).nullish(),
  email: z.string().email().nullish(),
  name: z.string().nullish(),
  avatarUrl: z.string().url().nullish(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;
```

`packages/core/src/schemas/api-key.ts`:

```ts
import { z } from 'zod';

export const createApiKeySchema = z.object({ name: z.string().min(1).max(100) });
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
```

Add both to `packages/core/src/schemas/index.ts`:

```ts
export * from './user';
export * from './api-key';
```

- [ ] **Step 4: Write the failing `user-service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { userService } from './user-service';
import { LOCAL_USER_ID } from '../constants';
import { NotFoundError } from '../errors';

function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

describe('userService', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });

  it('the migration-seeded local user is retrievable', () => {
    expect(userService.get(db, LOCAL_USER_ID).id).toBe(LOCAL_USER_ID);
  });

  it('ensureLocalUser is idempotent', () => {
    const a = userService.ensureLocalUser(db);
    const b = userService.ensureLocalUser(db);
    expect(a.id).toBe(LOCAL_USER_ID);
    expect(b.id).toBe(LOCAL_USER_ID);
  });

  it('creates and reads a user', () => {
    const u = userService.create(db, { githubId: 'gh-1', email: 'a@b.co', name: 'A' });
    expect(u.id).toMatch(/[0-9a-f-]{36}/);
    expect(userService.get(db, u.id).githubId).toBe('gh-1');
  });

  it('get throws NotFoundError for unknown id', () => {
    expect(() => userService.get(db, 'nope')).toThrow(NotFoundError);
  });

  it('upsertByGithubId inserts then updates the same row', () => {
    const first = userService.upsertByGithubId(db, { githubId: 'gh-9', name: 'Old' });
    const second = userService.upsertByGithubId(db, { githubId: 'gh-9', name: 'New' });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe('New');
    expect(userService.getByGithubId(db, 'gh-9')?.id).toBe(first.id);
  });
});
```

Run: `pnpm --filter @justdoit/core test user-service` → FAIL (module missing).

- [ ] **Step 5: Write `packages/core/src/services/user-service.ts`**

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { users, type User } from '../db/schema';
import { LOCAL_USER_ID } from '../constants';
import { NotFoundError } from '../errors';
import {
  createUserSchema,
  upsertGithubUserSchema,
  type CreateUserInput,
  type UpsertGithubUserInput,
} from '../schemas/user';

export const userService = {
  create(db: Db, input: CreateUserInput): User {
    const parsed = createUserSchema.parse(input);
    const [row] = db
      .insert(users)
      .values({
        ...(parsed.id ? { id: parsed.id } : {}),
        githubId: parsed.githubId ?? null,
        email: parsed.email ?? null,
        name: parsed.name ?? null,
        avatarUrl: parsed.avatarUrl ?? null,
      })
      .returning()
      .all();
    return row!;
  },

  get(db: Db, id: string): User {
    const row = db.select().from(users).where(eq(users.id, id)).get();
    if (!row) throw new NotFoundError('User', id);
    return row;
  },

  getByGithubId(db: Db, githubId: string): User | null {
    return db.select().from(users).where(eq(users.githubId, githubId)).get() ?? null;
  },

  upsertByGithubId(db: Db, input: UpsertGithubUserInput): User {
    const parsed = upsertGithubUserSchema.parse(input);
    const existing = userService.getByGithubId(db, parsed.githubId);
    if (existing) {
      const [row] = db
        .update(users)
        .set({
          email: parsed.email ?? existing.email,
          name: parsed.name ?? existing.name,
          avatarUrl: parsed.avatarUrl ?? existing.avatarUrl,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning()
        .all();
      return row!;
    }
    return userService.create(db, parsed);
  },

  /** Idempotently ensure the fixed local user exists (adapters/tests call this). */
  ensureLocalUser(db: Db): User {
    const existing = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).get();
    if (existing) return existing;
    return userService.create(db, { id: LOCAL_USER_ID, name: 'Local User' });
  },
};
```

Run: `pnpm --filter @justdoit/core test user-service` → PASS.

- [ ] **Step 6: Write the failing `api-key-service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { userService } from './user-service';
import { apiKeyService } from './api-key-service';
import { NotFoundError } from '../errors';

function seed(): { db: Db; userId: string } {
  const { db } = createDb(':memory:');
  runMigrations(db);
  const user = userService.create(db, { githubId: 'gh', name: 'Owner' });
  return { db, userId: user.id };
}

describe('apiKeyService', () => {
  let db: Db;
  let userId: string;
  beforeEach(() => {
    ({ db, userId } = seed());
  });

  it('create returns a raw token once and stores only its hash', () => {
    const { apiKey, token } = apiKeyService.create(db, userId, 'CLI');
    expect(token).toMatch(/^jdk_/);
    expect(apiKey.tokenHash).not.toBe(token);
    expect(apiKey.tokenHash).toHaveLength(64); // sha-256 hex
    expect(apiKey.name).toBe('CLI');
  });

  it('resolveToken maps a raw token to its owner and stamps last_used_at', () => {
    const { token } = apiKeyService.create(db, userId, 'CLI');
    const now = new Date('2026-07-08T00:00:00Z');
    expect(apiKeyService.resolveToken(db, token, now)).toBe(userId);
    const [key] = apiKeyService.listForUser(db, userId);
    expect(key!.lastUsedAt?.getTime()).toBe(now.getTime());
  });

  it('resolveToken returns null for an unknown or revoked token', () => {
    const { token } = apiKeyService.create(db, userId, 'CLI');
    expect(apiKeyService.resolveToken(db, 'jdk_bogus')).toBeNull();
    const [key] = apiKeyService.listForUser(db, userId);
    apiKeyService.revoke(db, userId, key!.id);
    expect(apiKeyService.resolveToken(db, token)).toBeNull();
  });

  it('revoke is owner-scoped — a different user cannot revoke', () => {
    const other = userService.create(db, { githubId: 'gh2', name: 'Other' }).id;
    const [key] = [apiKeyService.create(db, userId, 'CLI').apiKey];
    expect(() => apiKeyService.revoke(db, other, key!.id)).toThrow(NotFoundError);
    expect(apiKeyService.listForUser(db, userId)).toHaveLength(1);
  });
});
```

Run: `pnpm --filter @justdoit/core test api-key-service` → FAIL.

- [ ] **Step 7: Write `packages/core/src/services/api-key-service.ts`**

```ts
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { apiKeys, type ApiKey } from '../db/schema';
import { NotFoundError } from '../errors';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface CreateApiKeyResult {
  apiKey: ApiKey;
  /** Raw token — shown to the caller exactly once; never persisted. */
  token: string;
}

export const apiKeyService = {
  create(db: Db, userId: string, name: string, now: Date = new Date()): CreateApiKeyResult {
    const token = `jdk_${randomBytes(24).toString('base64url')}`;
    const [apiKey] = db
      .insert(apiKeys)
      .values({ userId, name, tokenHash: hashToken(token), createdAt: now })
      .returning()
      .all();
    return { apiKey: apiKey!, token };
  },

  listForUser(db: Db, userId: string): ApiKey[] {
    return db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(asc(apiKeys.createdAt))
      .all();
  },

  revoke(db: Db, userId: string, id: string): void {
    const deleted = db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .returning()
      .all();
    if (deleted.length === 0) throw new NotFoundError('API key', id);
  },

  /** Resolve a raw token to its owner id (or null), stamping last_used_at on hit. */
  resolveToken(db: Db, rawToken: string, now: Date = new Date()): string | null {
    const row = db.select().from(apiKeys).where(eq(apiKeys.tokenHash, hashToken(rawToken))).get();
    if (!row) return null;
    db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.id)).run();
    return row.userId;
  },
};
```

Run: `pnpm --filter @justdoit/core test api-key-service` → PASS.

- [ ] **Step 8: Export from `core`**

`packages/core/src/services/index.ts` add:

```ts
export * from './user-service';
export * from './api-key-service';
```

`packages/core/src/index.ts` add:

```ts
export * from './context';
export * from './scope';
```

- [ ] **Step 9: Typecheck + full core suite + commit**

Run: `pnpm --filter @justdoit/core typecheck && pnpm --filter @justdoit/core test`
Expected: PASS.

```bash
git add -A
git commit -m "feat(core): add Ctx, userScope, userService, apiKeyService"
```

---

## Task 3: Thread `userId` through the event bus + activity log; scope `activityService`

**Files:**

- Modify: `packages/core/src/events/bus.ts` (add `userId` to `DomainEvent`)
- Modify: `packages/core/src/events/emit.ts` (`emit(userId, …)`)
- Modify: **every** service file that calls `emit(` → pass `LOCAL_USER_ID` placeholder (rewired to `ctx.userId` in later tasks)
- Modify: `packages/core/src/services/activity-service.ts` (persist `userId`; `list(ctx, …)`)
- Modify: `apps/api/src/routes/activity.ts` (+ `activity.test.ts`)
- Create/extend: isolation coverage in `activity-service.test.ts`

**Interfaces:**

- Consumes: `Ctx`, `userScope`, `LOCAL_USER_ID`.
- Produces:
  - `DomainEvent` gains `userId: string`.
  - `emit(userId: string, entityType, entityId, action, payload?, at?)`.
  - `activityService.record(db, event)` stamps `activity_log.user_id = event.userId`.
  - `activityService.list(ctx, input?)` scoped to `ctx.userId`.

- [ ] **Step 1: Extend `DomainEvent` — `packages/core/src/events/bus.ts`**

Add `userId: string;` to the `DomainEvent` interface (after `type`).

- [ ] **Step 2: Change `emit` — `packages/core/src/events/emit.ts`**

```ts
export function emit(
  userId: string,
  entityType: EntityType,
  entityId: string,
  action: DomainEventAction,
  payload?: Record<string, unknown>,
  at: number = Date.now(),
): void {
  events.publish({ type: `${PREFIX[entityType]}.${action}`, userId, entityType, entityId, action, payload, at });
}
```

- [ ] **Step 3: Update every `emit(` call site to pass a userId placeholder**

In each of `project-service.ts`, `task-service.ts`, `time-service.ts` (the current `emit` callers), import `LOCAL_USER_ID` and prefix each call: `emit('task', id, …)` → `emit(LOCAL_USER_ID, 'task', id, …)`. These placeholders become `ctx.userId` when each service is converted (Tasks 4–8). Grep to find them all:

Run: `grep -rn "emit(" packages/core/src/services`
Expected: replace every occurrence so the first argument is `LOCAL_USER_ID`.

- [ ] **Step 4: Persist `userId` in the activity log — `activity-service.ts`**

`record` stamps `userId: event.userId`; `list` takes `ctx` and scopes:

```ts
import { and, desc, eq, sql } from 'drizzle-orm';
import { activityLog, type ActivityLogEntry } from '../db/schema';
import { events, type DomainEvent, type EntityType } from '../events/bus';
import { userScope } from '../scope';
import type { Ctx } from '../context';
import type { Db } from '../db';

export const activityService = {
  record(db: Db, event: DomainEvent): ActivityEntry {
    const [row] = db
      .insert(activityLog)
      .values({
        userId: event.userId,
        entityType: event.entityType,
        entityId: event.entityId,
        action: event.action,
        payload: event.payload ?? null,
        createdAt: new Date(event.at),
      })
      .returning()
      .all();
    return row!;
  },

  list(ctx: Ctx, input: ListActivityInput = {}): ActivityEntry[] {
    const conds = [userScope(activityLog, ctx.userId)];
    if (input.entityType) conds.push(eq(activityLog.entityType, input.entityType));
    if (input.entityId) conds.push(eq(activityLog.entityId, input.entityId));
    return ctx.db
      .select()
      .from(activityLog)
      .where(and(...conds))
      .orderBy(desc(activityLog.createdAt), desc(sql`rowid`))
      .limit(input.limit ?? 100)
      .all();
  },
};
```

`startActivityLog(db)` is unchanged (a bus subscriber calling `record(db, event)`).

- [ ] **Step 5: Update the activity route — `apps/api/src/routes/activity.ts`**

Build a ctx (local user) and pass it to `list`. (This is the first REST route to adopt the ctx pattern; the shared `setUserContext` middleware + `AppEnv` land in Task 4 — for now inline a local-user ctx here, then switch this handler to `c.var.ctx` in Task 4.)

```ts
import { LOCAL_USER_ID, activityService, type Db } from '@justdoit/core';
// inside the handler (interim, until Task 4 registers the ctx middleware):
const ctx = { db, userId: LOCAL_USER_ID };
return c.json(activityService.list(ctx, input));
```

- [ ] **Step 6: Update tests — `activity-service.test.ts` gains isolation coverage**

Add a case: record two events with different `userId` (via `emit` or by constructing events), then `activityService.list({ db, userId: 'A' })` returns only A's entries. Update existing calls `activityService.list(db, …)` → `activityService.list({ db, userId: LOCAL_USER_ID }, …)`. Update `apps/api/src/routes/activity.test.ts` similarly if it asserts shapes (route still local-user, so behavior unchanged).

- [ ] **Step 7: Verify + commit**

Run: `pnpm --filter @justdoit/core test && pnpm --filter @justdoit/api test activity`
Expected: PASS.

```bash
git add -A
git commit -m "feat(core): stamp userId on domain events + activity log; scope activity list"
```

---

## Task 4: Convert `projectService` to `Ctx` + REST/MCP adapters + isolation

**Files:**

- Modify: `packages/core/src/services/project-service.ts` (+ `project-service.test.ts`)
- Create: `apps/api/src/context.ts` (`AppEnv` + `setUserContext` middleware → `c.set('ctx', …)`)
- Modify: `apps/api/src/routes/projects.ts` (+ `projects.test.ts`)
- Modify: `apps/mcp/src/tools/projects.ts` (+ MCP tests)

**Interfaces:**

- Consumes: `Ctx`, `userScope`.
- Produces (all `db` → `ctx`):
  - `create(ctx, input)`, `get(ctx, id)`, `list(ctx, opts?)`, `update(ctx, id, patch)`, `remove(ctx, id)`.
  - `apps/api/src/context.ts`: `AppEnv = { Variables: { ctx: Ctx } }` and a `setUserContext(db): MiddlewareHandler<AppEnv>` that does `c.set('ctx', { db, userId: LOCAL_USER_ID })`. Registered once in `createApp`; every route reads `c.var.ctx`. (Phase 7b replaces only this middleware's identity resolution.)

- [ ] **Step 1: Rewrite `project-service.ts` (template for all CRUD services)**

```ts
import { and, asc, eq } from 'drizzle-orm';
import { projects, type Project } from '../db/schema';
import { NotFoundError } from '../errors';
import { userScope } from '../scope';
import type { Ctx } from '../context';
import {
  createProjectSchema,
  updateProjectSchema,
  type CreateProjectInput,
  type UpdateProjectInput,
} from '../schemas';
import { emit } from '../events/emit';

function nextPosition(ctx: Ctx): number {
  const rows = ctx.db
    .select({ position: projects.position })
    .from(projects)
    .where(userScope(projects, ctx.userId))
    .all();
  return rows.reduce((max, r) => Math.max(max, r.position), 0) + 1;
}

export const projectService = {
  create(ctx: Ctx, input: CreateProjectInput): Project {
    const parsed = createProjectSchema.parse(input);
    const [row] = ctx.db
      .insert(projects)
      .values({ ...parsed, userId: ctx.userId, position: nextPosition(ctx) })
      .returning()
      .all();
    emit(ctx.userId, 'project', row!.id, 'created', { name: row!.name });
    return row!;
  },

  get(ctx: Ctx, id: string): Project {
    const row = ctx.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), userScope(projects, ctx.userId)))
      .get();
    if (!row) throw new NotFoundError('Project', id);
    return row;
  },

  list(ctx: Ctx, opts: { archived?: boolean } = {}): Project[] {
    const conds = [userScope(projects, ctx.userId)];
    if (opts.archived !== undefined) conds.push(eq(projects.archived, opts.archived));
    return ctx.db
      .select()
      .from(projects)
      .where(and(...conds))
      .orderBy(asc(projects.position), asc(projects.createdAt))
      .all();
  },

  update(ctx: Ctx, id: string, patch: UpdateProjectInput): Project {
    const parsed = updateProjectSchema.parse(patch);
    projectService.get(ctx, id); // 404s a foreign id
    const [row] = ctx.db
      .update(projects)
      .set({ ...parsed, updatedAt: new Date() })
      .where(and(eq(projects.id, id), userScope(projects, ctx.userId)))
      .returning()
      .all();
    emit(ctx.userId, 'project', row!.id, 'updated', { patch });
    return row!;
  },

  remove(ctx: Ctx, id: string): void {
    projectService.get(ctx, id); // 404s a foreign id
    ctx.db.delete(projects).where(and(eq(projects.id, id), userScope(projects, ctx.userId))).run();
    emit(ctx.userId, 'project', id, 'deleted', {});
  },
};
```

- [ ] **Step 2: Add isolation tests — `project-service.test.ts`**

Add a `describe('cross-tenant isolation')` block. Update the existing `freshDb()` helper to seed two users and expose ctxs:

```ts
import { LOCAL_USER_ID } from '../constants';
import { userService } from './user-service';
import type { Ctx } from '../context';

function ctxFor(db: Db, userId: string): Ctx {
  return { db, userId };
}
// in beforeEach after runMigrations: userService.ensureLocalUser(db);
//   userService.create(db, { id: 'user-b', name: 'B' });
```

Cases (acting as A = `LOCAL_USER_ID`, B = `user-b`):

```ts
it('A cannot see, get, update, or delete B rows', () => {
  const a = ctxFor(db, LOCAL_USER_ID);
  const b = ctxFor(db, 'user-b');
  const bProj = projectService.create(b, { name: 'B secret' });

  expect(projectService.list(a).map((p) => p.id)).not.toContain(bProj.id);
  expect(() => projectService.get(a, bProj.id)).toThrow(NotFoundError);
  expect(() => projectService.update(a, bProj.id, { name: 'hijack' })).toThrow(NotFoundError);
  expect(() => projectService.remove(a, bProj.id)).toThrow(NotFoundError);
  // B still owns an untouched row.
  expect(projectService.get(b, bProj.id).name).toBe('B secret');
});
```

Convert all existing `projectService.x(db, …)` calls in the file to `projectService.x(ctxFor(db, LOCAL_USER_ID), …)`.

Run: `pnpm --filter @justdoit/core test project-service` → PASS.

- [ ] **Step 3: Write the API ctx middleware — `apps/api/src/context.ts`**

A single middleware sets `c.var.ctx` for every request. This is the exact seam Phase 7b builds on: 7b replaces **only** the identity resolution here (the `X-Internal-Key` / `X-API-Key` / local / 401 ladder) — route handlers keep reading `c.var.ctx` unchanged.

```ts
import type { MiddlewareHandler } from 'hono';
import { LOCAL_USER_ID, type Ctx, type Db } from '@justdoit/core';

/** Hono per-request environment: every route reads `c.var.ctx`. */
export type AppEnv = { Variables: { ctx: Ctx } };

/**
 * Set the per-request tenant context. Phase 7a is local mode only, so `userId`
 * always defaults to the fixed local user. Phase 7b replaces the body with the
 * X-Internal-Key / X-API-Key / local resolution ladder (spec §6); routes do not change.
 */
export function setUserContext(db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('ctx', { db, userId: LOCAL_USER_ID });
    return next();
  };
}
```

Register it once in `createApp` (before the route mounts): `app.use('*', setUserContext(db));`, and type the app as `new Hono<AppEnv>()`.

- [ ] **Step 4: Update `apps/api/src/routes/projects.ts`**

Each handler reads `const ctx = c.var.ctx;` and calls `projectService.x(ctx, …)`:

```ts
import { Hono } from 'hono';
import { projectService, createProjectSchema, updateProjectSchema, type Db } from '@justdoit/core';
import type { AppEnv } from '../context';

export function projectRoutes(db: Db): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.get('/', (c) => {
    const archived = c.req.query('archived');
    const opts = archived === undefined ? {} : { archived: archived === 'true' };
    return c.json(projectService.list(c.var.ctx, opts));
  });
  r.post('/', zValidator('json', createProjectSchema), (c) =>
    c.json(projectService.create(c.var.ctx, c.req.valid('json')), 201),
  );
  r.get('/:id', (c) => c.json(projectService.get(c.var.ctx, c.req.param('id'))));
  r.patch('/:id', zValidator('json', updateProjectSchema), (c) =>
    c.json(projectService.update(c.var.ctx, c.req.param('id'), c.req.valid('json'))),
  );
  r.delete('/:id', (c) => {
    projectService.remove(c.var.ctx, c.req.param('id'));
    return c.body(null, 204);
  });
  return r;
}
```

Also retrofit `apps/api/src/routes/activity.ts` (from Task 3) to read `c.var.ctx` instead of the inline ctx.

- [ ] **Step 5: Update the MCP project tools — `apps/mcp/src/tools/projects.ts`**

Inside `registerProjectTools(server, db)`, build a local-user ctx once and call services with it:

```ts
import { LOCAL_USER_ID, projectService, type Ctx, type Db } from '@justdoit/core';
export function registerProjectTools(server: McpServer, db: Db): void {
  const ctx: Ctx = { db, userId: LOCAL_USER_ID };
  // …tool bodies call projectService.x(ctx, …)
}
```

> MCP is single-user local in 7a; `LOCAL_USER_ID` is correct. 7b swaps this for a per-key ctx resolved from `X-API-Key`.

- [ ] **Step 6: Update API + MCP tests, run, commit**

Update `apps/api/src/routes/projects.test.ts` and MCP project-tool tests only where they set up data through the service directly (route/tool behavior is unchanged in local mode, so most assertions stand). Ensure the app instance seeds the local user — add `userService.ensureLocalUser(db)` to the test DB setup helper (see Task 15 for the shared helper), or rely on the migration seed (fresh `:memory:` DBs already contain `local-user`).

Run: `pnpm --filter @justdoit/core test project-service && pnpm --filter @justdoit/api test projects && pnpm --filter @justdoit/mcp test`
Expected: PASS.

```bash
git add -A
git commit -m "feat: scope projectService to Ctx (+REST/MCP local-user) with isolation tests"
```

---

## Task 5: Convert `taskService` (core CRUD + subtasks) and `schedule-service` reads to `Ctx`

**Files:**

- Modify: `packages/core/src/services/task-service.ts` (all non-bulk methods) (+ `task-service.test.ts`)
- Modify: `packages/core/src/services/schedule-service.ts` (`listOverdue/listDueToday/listUpcoming/spawnNextRecurrence`, `nextPosition`) (+ `schedule-service.test.ts`)
- Modify: `apps/api/src/routes/tasks.ts` (+ `tasks.test.ts`)
- Modify: `apps/mcp/src/tools/tasks.ts` (+ MCP task-tool tests)

**Interfaces:**

- Produces (`db` → `ctx`): `create`, `get`, `list`, `update`, `setStatus`, `complete`, `remove`, `addSubtask`, `listSubtasks`. Cross-entity refs validated to belong to `ctx.userId`:
  - `requireProject(ctx, projectId)` — project must be owned, else `NotFoundError`.
  - `parentTaskId` validated via `taskService.get(ctx, parentTaskId)` (owned → else 404).
  - Schedule window helpers scope by `userScope(tasks, ctx.userId)`: `listOverdue(ctx, now)`, `listDueToday(ctx, now)`, `listUpcoming(ctx, now, days?)`.
  - `spawnNextRecurrence(ctx, task, now)` stamps `userId: ctx.userId` on the spawned occurrence and copies only that user's `taskTags`.

- [ ] **Step 1: Convert `schedule-service.ts` first (task-service depends on it)**

Change signatures to take `ctx` and scope reads. Key changes:

```ts
import type { Ctx } from '../context';
import { userScope } from '../scope';

export function listOverdue(ctx: Ctx, now: Date): Task[] {
  return ctx.db.select().from(tasks)
    .where(and(userScope(tasks, ctx.userId), lt(tasks.dueAt, now), activeAndDue()))
    .orderBy(asc(tasks.dueAt)).all();
}
// listDueToday / listUpcoming: same pattern — prepend userScope(tasks, ctx.userId) to the and(...).

function nextPosition(ctx: Ctx, projectId: string | null, parentTaskId: string | null): number {
  const rows = ctx.db.select({ position: tasks.position }).from(tasks)
    .where(and(
      userScope(tasks, ctx.userId),
      projectId === null ? isNull(tasks.projectId) : eq(tasks.projectId, projectId),
      parentTaskId === null ? isNull(tasks.parentTaskId) : eq(tasks.parentTaskId, parentTaskId),
    )).all();
  return rows.reduce((m, r) => Math.max(m, r.position), 0) + 1;
}

export function spawnNextRecurrence(ctx: Ctx, task: Task, now: Date): Task | null {
  if (!task.recurrence) return null;
  // …compute next/delta unchanged…
  const [created] = ctx.db.insert(tasks).values({
    userId: ctx.userId,
    title: task.title, description: task.description, status: 'todo', priority: task.priority,
    projectId: task.projectId, parentTaskId: task.parentTaskId,
    position: nextPosition(ctx, task.projectId, task.parentTaskId),
    estimateMinutes: task.estimateMinutes, recurrence: task.recurrence,
    dueAt: task.dueAt ? new Date(task.dueAt.getTime() + delta) : null,
    startAt: task.startAt ? new Date(task.startAt.getTime() + delta) : null,
    completedAt: null,
  }).returning().all();
  if (!created) return null;
  const sourceTags = ctx.db.select({ tagId: taskTags.tagId }).from(taskTags)
    .where(eq(taskTags.taskId, task.id)).all();
  if (sourceTags.length) {
    ctx.db.insert(taskTags).values(sourceTags.map((t) => ({ taskId: created.id, tagId: t.tagId }))).run();
  }
  return created;
}
```

`assertValidWindow` is pure (no db) — leave unchanged.

- [ ] **Step 2: Convert `task-service.ts` non-bulk methods**

`requireProject` and helpers take `ctx`; every read/insert/update/delete scopes on `ctx.userId`; `emit` uses `ctx.userId`. Representative methods:

```ts
import type { Ctx } from '../context';
import { userScope } from '../scope';
import { projects } from '../db/schema';

function requireProject(ctx: Ctx, projectId: string): void {
  const row = ctx.db.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.id, projectId), userScope(projects, ctx.userId))).get();
  if (!row) throw new NotFoundError('Project', projectId);
}

export const taskService = {
  create(ctx: Ctx, input: CreateTaskInput): Task {
    const parsed = createTaskSchema.parse(input);
    if (parsed.projectId) requireProject(ctx, parsed.projectId);
    if (parsed.parentTaskId) {
      const parent = taskService.get(ctx, parsed.parentTaskId); // owned-or-404
      if (parent.parentTaskId) throw new ConflictError('Subtasks may only be one level deep');
    }
    assertValidWindow({ startAt: parsed.startAt ?? null, dueAt: parsed.dueAt ?? null });
    if (parsed.recurrence != null) assertValidRecurrence(parsed.recurrence);
    const position = nextPosition(ctx, parsed.projectId ?? null, parsed.parentTaskId ?? null);
    const [row] = ctx.db.insert(tasks).values({ ...parsed, userId: ctx.userId, position }).returning().all();
    emit(ctx.userId, 'task', row!.id, 'created', { title: row!.title });
    return row!;
  },

  get(ctx: Ctx, id: string): Task {
    const row = ctx.db.select().from(tasks)
      .where(and(eq(tasks.id, id), userScope(tasks, ctx.userId))).get();
    if (!row) throw new NotFoundError('Task', id);
    return row;
  },

  list(ctx: Ctx, filters: TaskListFilters = {}): Task[] {
    const conditions: SQL[] = [userScope(tasks, ctx.userId)];
    // …all existing filter pushes unchanged…
    if (filters.tagId) {
      const taskIds = ctx.db.select({ id: taskTags.taskId }).from(taskTags)
        .where(eq(taskTags.tagId, filters.tagId)).all().map((r) => r.id);
      conditions.push(inArray(tasks.id, taskIds.length ? taskIds : ['__none__']));
    }
    return ctx.db.select().from(tasks).where(and(...conditions))
      .orderBy(asc(tasks.position), asc(tasks.createdAt)).all();
  },
  // update/setStatus/complete/remove/addSubtask/listSubtasks: same mechanical transform —
  //   `db`→`ctx.db`, add `userScope(tasks, ctx.userId)` to every where, `emit(ctx.userId, …)`,
  //   `taskService.get(ctx, id)` for existence, `spawnNextRecurrence(ctx, task, now)`.
};
```

`nextPosition` in task-service becomes `nextPosition(ctx, projectId, parentTaskId)` (same as schedule-service's, scoped). `listSubtasks` scopes on `userScope(tasks, ctx.userId)` **and** `eq(tasks.parentTaskId, parentId)`.

- [ ] **Step 3: Isolation tests (`task-service.test.ts`, `schedule-service.test.ts`)**

Convert existing calls to `ctxFor(db, LOCAL_USER_ID)`. Add cross-tenant cases:

```ts
it('A cannot get/update/delete B task, nor reparent under B', () => {
  const bTask = taskService.create(b, { title: 'B task' });
  expect(() => taskService.get(a, bTask.id)).toThrow(NotFoundError);
  expect(() => taskService.setStatus(a, bTask.id, 'done')).toThrow(NotFoundError);
  expect(() => taskService.remove(a, bTask.id)).toThrow(NotFoundError);
  // reparent: A creates a task whose parent is B's task → 404 (parent not owned).
  expect(() => taskService.create(a, { title: 'child', parentTaskId: bTask.id })).toThrow(NotFoundError);
  // A cannot attach B's project.
  const bProj = projectService.create(b, { name: 'B proj' });
  expect(() => taskService.create(a, { title: 'x', projectId: bProj.id })).toThrow(NotFoundError);
});
it('listOverdue/DueToday/Upcoming exclude B tasks', () => { /* seed B overdue, assert a-side windows empty */ });
```

- [ ] **Step 4: Update `apps/api/src/routes/tasks.ts`**

Read `const ctx = c.var.ctx;` at the top of each handler. The `due` window branch uses `listOverdue(ctx, now)` etc. and `taskService.list(ctx, filters)`. `create/get/update/remove/setStatus/complete/subtasks` all take `ctx`.

- [ ] **Step 5: Update `apps/mcp/src/tools/tasks.ts`**

Build `const ctx: Ctx = { db, userId: LOCAL_USER_ID };` and call `taskService.*(ctx, …)`, `tagService.*(ctx, …)`, `listOverdue(ctx, …)` etc.

- [ ] **Step 6: Run + commit**

Run: `pnpm --filter @justdoit/core test task-service schedule-service recurrence && pnpm --filter @justdoit/api test tasks && pnpm --filter @justdoit/mcp test task`
Expected: PASS.

```bash
git add -A
git commit -m "feat: scope taskService + schedule-service to Ctx with cross-tenant isolation tests"
```

---

## Task 6: Convert `taskService.bulkUpdate` / `bulkDelete` to `Ctx`

**Files:**

- Modify: `packages/core/src/services/task-service.ts` (bulk methods) (+ `task-bulk.test.ts`)
- Modify: `apps/api/src/routes/tasks.ts` (bulk routes) (+ `tasks-bulk.test.ts`)

**Interfaces:**

- Produces: `bulkUpdate(ctx, ids, patch)`, `bulkDelete(ctx, ids)`. Bulk ops must reject if **any** id is not owned by `ctx.userId` (a foreign id → `NotFoundError`), and tag add/remove must only touch the acting user's rows.

- [ ] **Step 1: Convert bulk methods**

```ts
bulkUpdate(ctx: Ctx, ids: string[], patch: BulkPatch): Task[] {
  if (ids.length === 0) throw new ValidationError('bulkUpdate requires at least one id');
  const existing = ctx.db.select().from(tasks)
    .where(and(userScope(tasks, ctx.userId), inArray(tasks.id, ids))).all();
  const byId = new Map(existing.map((t) => [t.id, t]));
  const missing = ids.filter((id) => !byId.has(id)); // foreign or unknown ids both land here
  if (missing.length) throw new NotFoundError('Task(s)', missing.join(', '));
  // …setClause unchanged…
  ctx.db.update(tasks).set(setClause)
    .where(and(userScope(tasks, ctx.userId), inArray(tasks.id, ids))).run();
  // tag add/remove loops unchanged (ids already proven owned); emit(ctx.userId, …).
  const updated = ctx.db.select().from(tasks)
    .where(and(userScope(tasks, ctx.userId), inArray(tasks.id, ids))).all();
  // …emit loop with ctx.userId…
  return updated;
},

bulkDelete(ctx: Ctx, ids: string[]): { deleted: number } {
  if (ids.length === 0) throw new ValidationError('bulkDelete requires at least one id');
  const deleted = ctx.db.delete(tasks)
    .where(and(userScope(tasks, ctx.userId), inArray(tasks.id, ids))).returning().all();
  for (const t of deleted) emit(ctx.userId, 'task', t.id, 'deleted', {});
  return { deleted: deleted.length };
},
```

> Note the deliberate asymmetry: `bulkUpdate` throws on any foreign id (mutation must be all-or-nothing and observable), while `bulkDelete` silently skips non-owned ids (delete is idempotent; a foreign id simply isn't deleted and isn't counted). The isolation test pins both behaviors.

- [ ] **Step 2: Isolation tests — `task-bulk.test.ts`**

```ts
it('bulkUpdate rejects when an id belongs to B', () => {
  const bTask = taskService.create(b, { title: 'B' });
  const aTask = taskService.create(a, { title: 'A' });
  expect(() => taskService.bulkUpdate(a, [aTask.id, bTask.id], { status: 'done' })).toThrow(NotFoundError);
  expect(taskService.get(b, bTask.id).status).toBe('todo'); // untouched
});
it('bulkDelete only deletes A tasks', () => {
  const bTask = taskService.create(b, { title: 'B' });
  const aTask = taskService.create(a, { title: 'A' });
  expect(taskService.bulkDelete(a, [aTask.id, bTask.id])).toEqual({ deleted: 1 });
  expect(taskService.get(b, bTask.id)).toBeDefined();
});
```

- [ ] **Step 3: Update bulk routes + tests, run, commit**

Run: `pnpm --filter @justdoit/core test task-bulk && pnpm --filter @justdoit/api test tasks-bulk`
Expected: PASS.

```bash
git add -A
git commit -m "feat: scope task bulk ops to Ctx with cross-tenant isolation tests"
```

---

## Task 7: Convert `tagService` to `Ctx` (per-user name uniqueness, owned attach/detach)

**Files:**

- Modify: `packages/core/src/services/tag-service.ts` (+ `tag-service.test.ts`)
- Modify: `apps/api/src/routes/tags.ts`, `apps/api/src/routes/task-tags.ts` (+ tests)
- Modify: `apps/mcp/src/tools/projects.ts` or wherever tag tools live (grep) (+ tests)

**Interfaces:**

- Produces: `create/get/list/update/remove(ctx, …)`, `attach(ctx, taskId, tagId)`, `detach(ctx, taskId, tagId)`, `listForTask(ctx, taskId)`. Name uniqueness is per-user; `attach` validates **both** the task and the tag belong to `ctx.userId`.

- [ ] **Step 1: Rewrite `tag-service.ts`**

```ts
import { and, asc, eq } from 'drizzle-orm';
import { tags, taskTags, tasks, type Tag } from '../db/schema';
import { NotFoundError, ConflictError } from '../errors';
import { userScope } from '../scope';
import type { Ctx } from '../context';
import { createTagSchema, updateTagSchema, type CreateTagInput, type UpdateTagInput } from '../schemas';

function requireOwnedTask(ctx: Ctx, taskId: string): void {
  const row = ctx.db.select({ id: tasks.id }).from(tasks)
    .where(and(eq(tasks.id, taskId), userScope(tasks, ctx.userId))).get();
  if (!row) throw new NotFoundError('Task', taskId);
}

export const tagService = {
  create(ctx: Ctx, input: CreateTagInput): Tag {
    const parsed = createTagSchema.parse(input);
    const existing = ctx.db.select().from(tags)
      .where(and(userScope(tags, ctx.userId), eq(tags.name, parsed.name))).get();
    if (existing) throw new ConflictError(`Tag already exists: ${parsed.name}`);
    const [row] = ctx.db.insert(tags).values({ ...parsed, userId: ctx.userId }).returning().all();
    return row!;
  },
  get(ctx: Ctx, id: string): Tag {
    const row = ctx.db.select().from(tags)
      .where(and(eq(tags.id, id), userScope(tags, ctx.userId))).get();
    if (!row) throw new NotFoundError('Tag', id);
    return row;
  },
  list(ctx: Ctx): Tag[] {
    return ctx.db.select().from(tags).where(userScope(tags, ctx.userId)).orderBy(asc(tags.name)).all();
  },
  update(ctx: Ctx, id: string, patch: UpdateTagInput): Tag {
    const parsed = updateTagSchema.parse(patch);
    tagService.get(ctx, id);
    if (parsed.name !== undefined) {
      const clash = ctx.db.select().from(tags)
        .where(and(userScope(tags, ctx.userId), eq(tags.name, parsed.name))).get();
      if (clash && clash.id !== id) throw new ConflictError(`Tag already exists: ${parsed.name}`);
    }
    const [row] = ctx.db.update(tags).set({ ...parsed, updatedAt: new Date() })
      .where(and(eq(tags.id, id), userScope(tags, ctx.userId))).returning().all();
    return row!;
  },
  remove(ctx: Ctx, id: string): void {
    tagService.get(ctx, id);
    ctx.db.delete(tags).where(and(eq(tags.id, id), userScope(tags, ctx.userId))).run();
  },
  attach(ctx: Ctx, taskId: string, tagId: string): void {
    requireOwnedTask(ctx, taskId);   // task must be owned
    tagService.get(ctx, tagId);      // tag must be owned
    ctx.db.insert(taskTags).values({ taskId, tagId }).onConflictDoNothing().run();
  },
  detach(ctx: Ctx, taskId: string, tagId: string): void {
    requireOwnedTask(ctx, taskId);
    ctx.db.delete(taskTags).where(and(eq(taskTags.taskId, taskId), eq(taskTags.tagId, tagId))).run();
  },
  listForTask(ctx: Ctx, taskId: string): Tag[] {
    requireOwnedTask(ctx, taskId);
    return ctx.db.select({ id: tags.id, userId: tags.userId, name: tags.name, color: tags.color,
        createdAt: tags.createdAt, updatedAt: tags.updatedAt })
      .from(taskTags).innerJoin(tags, eq(taskTags.tagId, tags.id))
      .where(eq(taskTags.taskId, taskId)).orderBy(asc(tags.name)).all();
  },
};
```

- [ ] **Step 2: Isolation tests — `tag-service.test.ts`**

```ts
it('same tag name allowed across users; duplicate per user rejected', () => {
  tagService.create(a, { name: 'urgent' });
  expect(() => tagService.create(b, { name: 'urgent' })).not.toThrow();
  expect(() => tagService.create(a, { name: 'urgent' })).toThrow(ConflictError);
});
it('A cannot attach B tag, nor attach onto B task', () => {
  const aTask = taskService.create(a, { title: 'A' });
  const bTag = tagService.create(b, { name: 'secret' });
  expect(() => tagService.attach(a, aTask.id, bTag.id)).toThrow(NotFoundError); // B tag
  const bTask = taskService.create(b, { title: 'B' });
  const aTag = tagService.create(a, { name: 'mine' });
  expect(() => tagService.attach(a, bTask.id, aTag.id)).toThrow(NotFoundError); // B task
});
```

- [ ] **Step 3: Update tag/task-tag routes + MCP tag tools + tests, run, commit**

Run: `pnpm --filter @justdoit/core test tag-service && pnpm --filter @justdoit/api test "tags|task-tags" && pnpm --filter @justdoit/mcp test`
Expected: PASS.

```bash
git add -A
git commit -m "feat: scope tagService to Ctx (per-user uniqueness, owned attach) with isolation tests"
```

---

## Task 8: Convert `timeService` to `Ctx`

**Files:**

- Modify: `packages/core/src/services/time-service.ts` (+ `time-service.test.ts`)
- Modify: `apps/api/src/routes/time-entries.ts` (+ `time-entries.test.ts`)
- Modify: `apps/mcp/src/tools/time.ts` (+ tests)

**Interfaces:**

- Produces: `getRunning(ctx)`, `startTimer(ctx, taskId, now?)`, `stopTimer(ctx, ref?, now?)`, `logManual(ctx, input, now?)`, `listEntries(ctx, filter?)`, `updateEntry(ctx, id, patch, now?)`, `deleteEntry(ctx, id)`. All entries stamp/scope `userId`; the task referenced by `startTimer`/`logManual` must be owned (`requireOwnedTask`). The single-running-timer invariant is now **per user**.

- [ ] **Step 1: Rewrite `time-service.ts`**

Mechanical transform plus these specifics:

```ts
function requireOwnedTask(ctx: Ctx, taskId: string): void { /* eq(tasks.id) && userScope(tasks) → NotFound */ }

getRunning(ctx: Ctx): TimeEntry | null {
  return ctx.db.select().from(timeEntries)
    .where(and(userScope(timeEntries, ctx.userId), isNull(timeEntries.endedAt)))
    .orderBy(desc(timeEntries.startedAt)).limit(1).get() ?? null;
}
startTimer(ctx, taskId, now = new Date()) {
  requireOwnedTask(ctx, taskId);
  const running = timeService.getRunning(ctx);         // per-user running timer
  if (running) timeService.stopTimer(ctx, { entryId: running.id }, now);
  const [entry] = ctx.db.insert(timeEntries).values({ userId: ctx.userId, taskId, /* … */ }).returning().all();
  emit(ctx.userId, 'time_entry', entry!.id, 'started', { taskId: entry!.taskId });
  return entry!;
}
```

Every `select/update/delete` on `timeEntries` composes `userScope(timeEntries, ctx.userId)`. `stopTimer`'s entryId branch: `where(and(eq(timeEntries.id, ref.entryId), userScope(timeEntries, ctx.userId)))` → foreign entry 404s. `listEntries` prepends `userScope(timeEntries, ctx.userId)` to `conds`; the `projectId` join branch keeps `userScope(timeEntries, ctx.userId)` in its where too (the joined `tasks` are already the user's, but scope the driving table explicitly). `logManual` stamps `userId: ctx.userId` and calls `requireOwnedTask(ctx, input.taskId)`.

- [ ] **Step 2: Isolation tests — `time-service.test.ts`**

```ts
it('A cannot log time against B task, nor see/stop/update/delete B entries', () => {
  const bTask = taskService.create(b, { title: 'B' });
  expect(() => timeService.startTimer(a, bTask.id)).toThrow(NotFoundError);
  expect(() => timeService.logManual(a, { taskId: bTask.id, startedAt: new Date(), durationSeconds: 60 })).toThrow(NotFoundError);
  const bEntry = timeService.logManual(b, { taskId: bTask.id, startedAt: new Date(), durationSeconds: 60 });
  expect(timeService.listEntries(a).map((e) => e.id)).not.toContain(bEntry.id);
  expect(() => timeService.stopTimer(a, { entryId: bEntry.id })).toThrow(NotFoundError);
  expect(() => timeService.deleteEntry(a, bEntry.id)).toThrow(NotFoundError);
});
it('running-timer invariant is per user (A and B can each run one)', () => {
  const at = taskService.create(a, { title: 'A' }); const bt = taskService.create(b, { title: 'B' });
  timeService.startTimer(a, at.id); timeService.startTimer(b, bt.id);
  expect(timeService.getRunning(a)?.taskId).toBe(at.id);
  expect(timeService.getRunning(b)?.taskId).toBe(bt.id);
});
```

- [ ] **Step 3: Update routes + MCP time tools + tests, run, commit**

Run: `pnpm --filter @justdoit/core test time-service && pnpm --filter @justdoit/api test time-entries && pnpm --filter @justdoit/mcp test time`
Expected: PASS.

```bash
git add -A
git commit -m "feat: scope timeService to Ctx (per-user running-timer) with isolation tests"
```

---

## Task 9: Convert `reportService` to `Ctx`

**Files:**

- Modify: `packages/core/src/services/report-service.ts` (+ `report-service.test.ts`)
- Modify: `apps/api/src/routes/reports.ts` (+ `reports.test.ts`)
- Modify: MCP misc tools if reports are exposed there (grep) (+ tests)

**Interfaces:**

- Produces: `timeReport(ctx, query)`. Every source query (`timeEntries` join `tasks`, `projects` lookup, `tags` join) filters to `ctx.userId`.

- [ ] **Step 1: Scope `timeReport`**

Add `userScope(timeEntries, ctx.userId)` to the `conds` array driving the main aggregation. Scope the `projectNames` lookup with `userScope(projects, ctx.userId)` and the tag-relation lookup by joining through the user's tasks (add `userScope(tasks, ctx.userId)` via an inner join on `taskTags.taskId = tasks.id` filtered by owner, or scope `tags` with `userScope(tags, ctx.userId)`). Signature: `timeReport(ctx: Ctx, query: TimeReportQuery): TimeReport` using `ctx.db`.

- [ ] **Step 2: Isolation test**

```ts
it('report totals exclude B time', () => {
  // seed A: 60s on an A task; seed B: 3600s on a B task
  const r = reportService.timeReport(a, { groupBy: 'day' });
  expect(r.totalSeconds).toBe(60);
  expect(r.estimateVsActual.every((e) => e.taskId !== bTaskId)).toBe(true);
});
```

- [ ] **Step 3: Update route + tests, run, commit**

Run: `pnpm --filter @justdoit/core test report-service && pnpm --filter @justdoit/api test reports`
Expected: PASS.

```bash
git add -A
git commit -m "feat: scope reportService to Ctx with isolation test"
```

---

## Task 10: Convert `reminderService` to `Ctx`

**Files:**

- Modify: `packages/core/src/services/reminder-service.ts` (+ `reminder-service.test.ts`)
- Modify: `apps/api/src/routes/reminders.ts` (+ `reminders.test.ts`)
- Note: the in-process scheduler (see Task 15) drives `dueReminders`/`markDelivered`.

**Interfaces:**

- Produces: `create(ctx, input)`, `get(ctx, id)`, `list(ctx, filter?)`, `update(ctx, id, input)`, `remove(ctx, id)`, `markDelivered(ctx, id)`, and a scheduler-facing `dueReminders(db, now)` that returns **all** users' due reminders (the scheduler is system-wide, not per-user).

- [ ] **Step 1: Rewrite `reminder-service.ts`**

`create` calls `requireOwnedTask(ctx, input.taskId)` and stamps `userId: ctx.userId`. `get/list/update/remove/markDelivered` scope on `userScope(reminders, ctx.userId)`. **Keep `dueReminders(db: Db, now: Date)` on a bare `db`** (no ctx) — it feeds the process-wide scheduler which must see every user's reminders; each delivered reminder already carries its `userId` for any per-user surfacing. Document this exception in a comment.

- [ ] **Step 2: Isolation tests**

```ts
it('A cannot create against B task, nor get/update/delete/markDelivered B reminder', () => {
  const bTask = taskService.create(b, { title: 'B' });
  expect(() => reminderService.create(a, { taskId: bTask.id, remindAt: new Date() })).toThrow(NotFoundError);
  const bRem = reminderService.create(b, { taskId: bTask.id, remindAt: new Date() });
  expect(reminderService.list(a).map((r) => r.id)).not.toContain(bRem.id);
  expect(() => reminderService.markDelivered(a, bRem.id)).toThrow(NotFoundError);
});
it('dueReminders (scheduler) sees all users', () => {
  // seed A + B past-due reminders → dueReminders(db, now) returns both
});
```

- [ ] **Step 3: Update route + tests, run, commit**

Run: `pnpm --filter @justdoit/core test reminder-service && pnpm --filter @justdoit/api test reminders`
Expected: PASS.

```bash
git add -A
git commit -m "feat: scope reminderService to Ctx (system-wide dueReminders) with isolation tests"
```

---

## Task 11: Convert `savedFilterService` to `Ctx`

**Files:**

- Modify: `packages/core/src/services/saved-filter-service.ts` (+ `saved-filter-service.test.ts`)
- Modify: `apps/api/src/routes/saved-filters.ts` (+ `saved-filters.test.ts`)

**Interfaces:**

- Produces: `create(ctx, input, now?)`, `list(ctx)`, `get(ctx, id)`, `update(ctx, id, input, now?)`, `remove(ctx, id)`.

- [ ] **Step 1: Rewrite** — stamp `userId: ctx.userId` on insert; scope `list/get/update/remove` on `userScope(savedFilters, ctx.userId)`.

- [ ] **Step 2: Isolation test** — A's `list` excludes B's filters; `get/update/remove` of B's id → `NotFoundError`.

- [ ] **Step 3: Update route + tests, run, commit**

Run: `pnpm --filter @justdoit/core test saved-filter && pnpm --filter @justdoit/api test saved-filters`
Expected: PASS.

```bash
git add -A
git commit -m "feat: scope savedFilterService to Ctx with isolation test"
```

---

## Task 12: Convert `attachmentService` to `Ctx`

**Files:**

- Modify: `packages/core/src/services/attachment-service.ts` (+ `attachment-service.test.ts`)
- Modify: `apps/api/src/routes/attachments.ts` (+ `attachments.test.ts`)

**Interfaces:**

- Produces: `add(ctx, input, opts?)`, `list(ctx, taskId)`, `get(ctx, id, opts?)`, `remove(ctx, id, opts?)`. `add` validates the task is owned and stamps `userId: ctx.userId`; `list/get/remove` scope on `userScope(attachments, ctx.userId)`.

- [ ] **Step 1: Rewrite** — `add`: replace the task existence check with `requireOwnedTask(ctx, input.taskId)` (owned-or-404) and add `userId: ctx.userId` to the insert. `list(ctx, taskId)`: `where(and(userScope(attachments, ctx.userId), eq(attachments.taskId, taskId)))`. `get(ctx, id, opts)`: `where(and(eq(attachments.id, id), userScope(attachments, ctx.userId)))` → foreign id 404s. `remove` delegates to `get(ctx, …)`.

- [ ] **Step 2: Isolation test**

```ts
it('A cannot add onto B task, nor list/get/remove B attachments', async () => {
  const bTask = taskService.create(b, { title: 'B' });
  await expect(attachmentService.add(a, { taskId: bTask.id, filename: 'x.txt', mime: 'text/plain', data: new Uint8Array([1]) }, { filesDir })).rejects.toThrow(NotFoundError);
  const att = await attachmentService.add(b, { taskId: bTask.id, filename: 'y.txt', mime: 'text/plain', data: new Uint8Array([1]) }, { filesDir });
  expect(() => attachmentService.get(a, att.id, { filesDir })).toThrow(NotFoundError);
});
```

- [ ] **Step 3: Update route + tests, run, commit**

Run: `pnpm --filter @justdoit/core test attachment-service && pnpm --filter @justdoit/api test attachments`
Expected: PASS.

```bash
git add -A
git commit -m "feat: scope attachmentService to Ctx with isolation test"
```

---

## Task 13: Convert `quickAddService.create` to `Ctx`

**Files:**

- Modify: `packages/core/src/services/quick-add.ts` (+ `quick-add.test.ts`)
- Modify: `apps/api/src/routes/quick-add.ts`, and the MCP tool exposing quick-add (grep `quickAdd`) (+ tests)

**Interfaces:**

- Produces: `quickAddService.parse(text, now?)` (unchanged — pure), `quickAddService.create(ctx, text, now?)`. Project/tag lookups by name are scoped to `ctx.userId`; created projects/tags/tasks go through the now-ctx services (auto-stamped).

- [ ] **Step 1: Rewrite `create`**

```ts
create(ctx: Ctx, text: string, now: Date = new Date()): Task {
  const parsed = parseQuickAdd(text, now);
  if (!parsed.title) throw new ValidationError('Quick-add text produced an empty title');
  let projectId: string | undefined;
  if (parsed.projectName) {
    const existing = ctx.db.select().from(projects)
      .where(and(userScope(projects, ctx.userId), eq(projects.name, parsed.projectName))).get();
    projectId = existing ? existing.id : projectService.create(ctx, { name: parsed.projectName }).id;
  }
  const task = taskService.create(ctx, {
    title: parsed.title, priority: parsed.priority ?? null,
    projectId: projectId ?? null, dueAt: parsed.dueAt ?? null,
  });
  for (const name of parsed.tags) {
    const existing = ctx.db.select().from(tags)
      .where(and(userScope(tags, ctx.userId), eq(tags.name, name))).get();
    const tag = existing ?? tagService.create(ctx, { name });
    tagService.attach(ctx, task.id, tag.id);
  }
  return taskService.get(ctx, task.id);
}
```

`quickAddService.parse` stays a pure function taking `(text, now?)`.

- [ ] **Step 2: Isolation test** — quick-add for A that references `@ProjectName` creates/reuses only A's project; B with the same `@ProjectName` gets a distinct project (per-user name space). Tags likewise reuse only within the user.

- [ ] **Step 3: Update route + MCP tool + tests, run, commit**

Run: `pnpm --filter @justdoit/core test quick-add && pnpm --filter @justdoit/api test quick && pnpm --filter @justdoit/mcp test`
Expected: PASS.

```bash
git add -A
git commit -m "feat: scope quickAddService to Ctx with isolation test"
```

---

## Task 14: Convert `exportService` to `Ctx` (per-user export/import)

**Files:**

- Modify: `packages/core/src/services/export-service.ts` (+ `export-service.test.ts`)
- Modify: `apps/api/src/routes/transfer.ts` (+ `transfer.test.ts`)

**Interfaces:**

- Produces: `exportSnapshot(ctx): Snapshot`, `importSnapshot(ctx, snapshot): ImportResult`. Export selects only `ctx.userId` rows. Import deletes only the acting user's rows and **re-stamps every inserted row with `ctx.userId`** (ignoring any `userId` present in the snapshot), so A can never import into B.

- [ ] **Step 1: Scope `exportSnapshot`**

Every `db.select().from(x).all()` becomes `ctx.db.select().from(x).where(userScope(x, ctx.userId)).all()`. `taskTags` has no `user_id`, so select only the join rows whose `taskId` belongs to the user:

```ts
taskTags: ctx.db.select({ taskId: taskTags.taskId, tagId: taskTags.tagId })
  .from(taskTags).innerJoin(tasks, eq(taskTags.taskId, tasks.id))
  .where(userScope(tasks, ctx.userId)).all(),
```

- [ ] **Step 2: Scope `importSnapshot`**

Inside the transaction, replace the blanket `tx.delete(x).run()` calls with owner-scoped deletes (`tx.delete(x).where(userScope(x, ctx.userId)).run()`); delete `taskTags` for the user's tasks via a subquery/`inArray` over the user's task ids. Re-stamp every inserted row: map each row through `{ ...row, userId: ctx.userId }` before insert (drop any incoming `userId`). Keep the top-level-then-children task ordering and the timestamp coercion. Return counts as today.

- [ ] **Step 3: Isolation tests — `export-service.test.ts`**

```ts
it('export returns only the acting user data', () => {
  projectService.create(a, { name: 'A only' });
  projectService.create(b, { name: 'B only' });
  const snap = exportService.exportSnapshot(a);
  expect(snap.projects.map((p) => p.name)).toEqual(['A only']);
});
it('import re-stamps to the acting user and never writes into B', () => {
  const bProj = projectService.create(b, { name: 'B before' });
  const snap = exportService.exportSnapshot(a); // A snapshot
  // Even a hand-forged snapshot claiming userId:'user-b' imports as A:
  const forged = { ...snap, projects: snap.projects.map((p) => ({ ...p, userId: 'user-b' })) };
  exportService.importSnapshot(a, forged);
  expect(projectService.get(b, bProj.id).name).toBe('B before'); // B untouched
  expect(exportService.exportSnapshot(a).projects.every((p) => p.userId === LOCAL_USER_ID)).toBe(true);
});
```

- [ ] **Step 4: Update transfer route + tests, run, commit**

Run: `pnpm --filter @justdoit/core test export-service && pnpm --filter @justdoit/api test transfer`
Expected: PASS.

```bash
git add -A
git commit -m "feat: scope exportService import/export to Ctx with isolation tests"
```

---

## Task 15: Wire adapters end-to-end (app, MCP, scheduler) under local-user

**Files:**

- Modify: `apps/api/src/app.ts` (seed local user on boot; scheduler ctx)
- Modify: the reminder scheduler entrypoint (grep `dueReminders`/`markDelivered` under `apps/api/src`)
- Modify: `apps/api/src/routes/events.ts` (+ `events.test.ts`) — filter the SSE stream by `c.var.ctx.userId`
- Modify: `apps/mcp/src/server.ts`, `apps/mcp/src/resources.ts` (build local-user ctx; scope resource reads)
- Modify: any remaining route/tool/test still calling a service with a bare `db`
- Modify: API + MCP shared test helpers to `ensureLocalUser`

**Interfaces:**

- Consumes: every converted service + `setUserContext`/`c.var.ctx` + `userService.ensureLocalUser`.
- Produces: a fully compiling, passing app where every request/tool resolves to `local-user`; the `/events` SSE route emits **only** events whose `userId` matches the acting `c.var.ctx.userId` (per-user isolation — data-leak vector closed, not deferred).

- [ ] **Step 1: Seed the local user on app boot — `apps/api/src/app.ts`**

In `createApp`, after obtaining `db`, call `userService.ensureLocalUser(db)` (idempotent) so a brand-new file DB (which ran migrations and already has the seed) and any edge case both guarantee `local-user` exists before requests arrive. Import `userService` from `@justdoit/core`.

- [ ] **Step 1b: Filter the `/events` SSE stream by the acting user**

Domain events now carry `userId` (Task 3). The `/events` route MUST forward to a client **only** the events whose `userId` matches `c.var.ctx.userId`, so a user never receives another user's events. In the SSE handler, read `const { userId } = c.var.ctx;` and drop any event where `event.userId !== userId`:

```ts
// apps/api/src/routes/events.ts — inside the bus subscription that writes to the stream:
const { userId } = c.var.ctx;
const unsub = events.subscribe((event) => {
  if (event.userId !== userId) return; // per-user isolation — never leak across tenants
  void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
});
```

Add a route-level test that seeds two users, subscribes as user A, emits an event for user A and one for user B, and asserts A's stream receives only A's event. (In 7a both requests resolve to `local-user`; the two-user HTTP assertion is exercised end-to-end in Phase 7b's hosted smoke, but the filter predicate and its test land **here**, concretely.)

- [ ] **Step 2: Scheduler** — the in-process reminder loop calls `reminderService.dueReminders(db, now)` (system-wide, unchanged) and, to mark delivered, either uses a per-reminder ctx (`reminderService.markDelivered({ db, userId: reminder.userId }, reminder.id)`) or a dedicated system helper. Update it to build `{ db, userId: reminder.userId }` from each due reminder so `markDelivered`'s owner scope passes.

- [ ] **Step 3: MCP resources — `apps/mcp/src/resources.ts`**

Build `const ctx: Ctx = { db, userId: LOCAL_USER_ID };` and route every resource read through the ctx services (e.g. `taskService.list(ctx, …)`, `projectService.list(ctx)`). Ensure `createMcpServer(db)` still seeds/relies on `local-user` (add `userService.ensureLocalUser(db)` in `createMcpServer`).

- [ ] **Step 4: Shared test helpers** — in API/MCP test bootstrap that builds a DB, ensure `local-user` exists. Fresh `:memory:` DBs already get it from the migration; add `userService.ensureLocalUser(db)` only where a test constructs a DB without full migrations.

- [ ] **Step 5: Sweep for stragglers**

Run: `grep -rn "Service\.\(create\|get\|list\|update\|remove\|add\)\s*(\s*db" apps packages` and `pnpm typecheck`
Expected: no service still called with a bare `db` (only `userService`/`apiKeyService`/`reminderService.dueReminders`/`activityService.record`/`startActivityLog` legitimately take `db`). Fix any remaining call sites.

- [ ] **Step 6: Full monorepo gates + commit**

Run: `pnpm typecheck && pnpm test`
Expected: all packages PASS (all pre-existing tests green under local-user + every new isolation test).

```bash
git add -A
git commit -m "feat: wire REST/MCP/scheduler adapters to local-user Ctx"
```

---

## Task 16: Harden — remove the transitional owner default; consolidated isolation gate

**Files:**

- Modify: `packages/core/src/db/schema.ts` (drop `.$defaultFn` from `ownerId`)
- Create: `packages/core/src/isolation.test.ts` (consolidated security-gate sweep)

**Interfaces:**

- Produces: `user_id` is now a **required** insert field type-wide (`$inferInsert`), so the compiler guarantees every insert stamps `userId: ctx.userId`. A single dedicated suite proves §2 across all entities.

- [ ] **Step 1: Remove the transitional default — `schema.ts`**

Change `ownerId` to drop the `$defaultFn` (and the now-unused `LOCAL_USER_ID` import from schema.ts):

```ts
const ownerId = () =>
  text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' });
```

- [ ] **Step 2: Typecheck — the compiler now enforces stamping**

Run: `pnpm --filter @justdoit/core typecheck`
Expected: PASS. If any insert is flagged (a service or the export importer that forgot `userId: ctx.userId`), fix it — this is exactly the safety net the removal provides. The migration is unaffected (it keeps its physical `DEFAULT 'local-user'` for backfilling legacy rows).

- [ ] **Step 3: Write the consolidated isolation suite — `packages/core/src/isolation.test.ts`**

One suite that seeds users A and B, creates one row of every entity for B, then asserts — acting as A — that A cannot list/get/update/delete any B row and cannot cross-reference B (attach B tag, reparent under B task, log time against B task, add attachment onto B task, import a forged B snapshot). This is the security gate referenced by the spec (§2/§5). Structure:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from './db';
import { userService } from './services/user-service';
import {
  projectService, taskService, tagService, timeService, reminderService,
  savedFilterService, attachmentService, exportService,
} from './services';
import { LOCAL_USER_ID } from './constants';
import { NotFoundError } from './errors';
import type { Ctx } from './context';

describe('cross-tenant isolation (security gate, spec §2)', () => {
  let db: Db; let a: Ctx; let b: Ctx;
  beforeEach(() => {
    ({ db } = createDb(':memory:')); runMigrations(db);
    userService.ensureLocalUser(db);
    userService.create(db, { id: 'user-b', name: 'B' });
    a = { db, userId: LOCAL_USER_ID }; b = { db, userId: 'user-b' };
  });

  it('lists never leak B rows to A', () => {
    projectService.create(b, { name: 'B' });
    taskService.create(b, { title: 'B' });
    tagService.create(b, { name: 'B' });
    expect(projectService.list(a)).toHaveLength(0);
    expect(taskService.list(a)).toHaveLength(0);
    expect(tagService.list(a)).toHaveLength(0);
    expect(savedFilterService.list(a)).toHaveLength(0);
  });

  it('by-id access to B rows returns NotFound for A', () => {
    const p = projectService.create(b, { name: 'B' });
    const t = taskService.create(b, { title: 'B' });
    for (const call of [
      () => projectService.get(a, p.id),
      () => projectService.remove(a, p.id),
      () => taskService.get(a, t.id),
      () => taskService.remove(a, t.id),
    ]) expect(call).toThrow(NotFoundError);
  });

  it('A cannot cross-reference B entities', () => {
    const bTask = taskService.create(b, { title: 'B' });
    const bTag = tagService.create(b, { name: 'B' });
    const aTask = taskService.create(a, { title: 'A' });
    expect(() => taskService.create(a, { title: 'x', parentTaskId: bTask.id })).toThrow(NotFoundError);
    expect(() => tagService.attach(a, aTask.id, bTag.id)).toThrow(NotFoundError);
    expect(() => timeService.startTimer(a, bTask.id)).toThrow(NotFoundError);
    expect(() => reminderService.create(a, { taskId: bTask.id, remindAt: new Date() })).toThrow(NotFoundError);
  });
});
```

- [ ] **Step 4: Full gates + commit**

Run: `pnpm typecheck && pnpm test`
Expected: all PASS — the consolidated gate plus every per-service isolation test and all pre-existing tests (under local-user).

```bash
git add -A
git commit -m "feat(core): enforce mandatory userId stamping + consolidated cross-tenant isolation gate"
```

---

## Phase 7a Definition of Done

- `pnpm typecheck && pnpm test` pass across the monorepo.
- All pre-existing tests (306 at branch start) remain green, now running under the fixed `local-user`.
- New tenancy tests all green: `migration.test.ts` (backfill against a DB with pre-existing data), `user-service.test.ts`, `api-key-service.test.ts`, per-service cross-tenant isolation tests, and the consolidated `isolation.test.ts` security gate.
- Schema has `users` + `api_keys` and a `NOT NULL user_id` (indexed, FK-declared) on all eight user-owned tables; `tags` uniqueness is per-user (`unique(user_id, name)`).
- The `0001_multitenancy` migration seeds `local-user` and backfills existing rows; a fresh `:memory:` DB and an existing file DB both work unchanged for local usage.
- Every user-owned service method takes `Ctx`; reads scope on `userScope`, inserts stamp `userId`, by-id/cross-entity access to a foreign id yields `NotFoundError`. `user_id` is a required insert field (transitional default removed), so the compiler prevents unstamped inserts.
- `userService` (`create`/`get`/`getByGithubId`/`upsertByGithubId`/`ensureLocalUser`) and `apiKeyService` (`create` returning raw+hash / `listForUser` / `revoke` / `resolveToken` with `last_used_at`) exist and are exported.
- A single `setUserContext` middleware sets `c.set('ctx', { db, userId })` (default `LOCAL_USER_ID`); every REST route reads `c.var.ctx`; MCP tools/resources build a `local-user` ctx; the app boots and serves as before.
- The `/events` SSE route filters emitted events to `c.var.ctx.userId` (per-user isolation), with a test — not deferred.

## Notes for 7b / 7c

- **7b auth resolution:** replace only the body of the `setUserContext` middleware (`apps/api/src/context.ts`, or a `middleware/auth.ts` `resolveUser`) with the spec §6 ladder — valid `X-Internal-Key` ⇒ trust `X-User-Id` (web proxy); else valid `X-API-Key` ⇒ `apiKeyService.resolveToken(db, key)` ⇒ `userId`; else local mode ⇒ `local-user`, hosted mode ⇒ 401. Routes keep reading `c.var.ctx` unchanged. The `apiKeyService.resolveToken` + `userService.upsertByGithubId` built here are exactly the primitives Auth.js and the key-gated `/mcp` route consume. Add `JUSTDOIT_MODE` handling.
- **Hosted MCP is served by `apps/api`:** MCP tools/resources here take a `Ctx`; 7b adds a key-gated `/mcp` streamable-HTTP route **on `apps/api`** that resolves each request's `X-API-Key` to a `userId` (same ladder) and reuses `createMcpServer(ctx)`. `apps/mcp` stays local-stdio only (`local-user`). The per-tool-file `ctx` seam introduced here makes that a localized change.
- **SSE per-user filtering (done in Task 15 Step 1b):** domain events carry `userId` and the `/events` route already filters by `c.var.ctx.userId`; 7b's hosted identity simply resolves a real `userId` into that same filter so hosted browsers only receive their own changes.
- **Reminder scheduler:** `dueReminders(db, now)` is deliberately system-wide; hosted "due/overdue" surfacing is per-user via each reminder's `userId`.
- **7c physical FK + default cleanup:** the two documented divergences (DB column keeps `DEFAULT 'local-user'`; DB lacks the `user_id` FK) can be reconciled during the Railway cutover by a squashed baseline migration that rebuilds the eight tables with the physical FK and no column default. Until then, do not run `db:generate` (it would emit spurious table-rebuild migrations). Isolation remains code-enforced regardless.
- **Users are global:** `userService`/`apiKeyService` intentionally take a bare `db` (users aren't user-owned); `apiKeyService.create/list/revoke` take an explicit `userId` argument and self-scope.
