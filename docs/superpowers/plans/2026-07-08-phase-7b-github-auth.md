# Phase 7b: GitHub Auth, Web→API Proxy & Per-User API Keys — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the hosted deployment real end-to-end: the `api` (public but with **every route auth-gated**) resolves a `userId` for every request from one of three trust sources; the public `web` app gates every page behind GitHub OAuth (allowlist-only) and forwards browser calls to `api` over internal DNS through a same-origin proxy that injects the user's identity server-side; users mint and revoke their own API keys from a Settings screen; and external agents reach a **key-gated `/mcp` streamable-HTTP route served by `apps/api`** that resolves each incoming key to its owner. There is **no separate hosted `mcp` service** — `apps/mcp` stays local-stdio only. Local dev stays **zero-login** throughout.

**Architecture:** `apps/api` gains a `resolveUser` middleware that populates a Hono `ctx` context variable (`{ db, userId }`) from — in order — a trusted internal key + `X-User-Id`, a per-user `X-API-Key`, local-mode `local-user`, else `401`. `apps/web` gains Auth.js (NextAuth v5) with a GitHub provider, an allowlist `signIn` gate, a `userId`-bearing session, edge middleware protecting all routes, and a `/api/backend/[...path]` catch-all proxy. `apps/api` also serves a key-gated **`/mcp`** streamable-HTTP route that mints a per-session MCP server bound to the `userId` resolved from `X-API-Key` (reusing `createMcpServer(ctx)`); `apps/mcp` remains a **local-stdio** entrypoint (`local-user`). All tenant scoping already lives in `packages/core` (Phase 7a) — 7b only wires **identity** into the adapters.

**Tech Stack:** unchanged from Phases 0–6 (TypeScript 5.7 strict, Hono, Next.js 15 App Router, Vitest 3, RTL, Playwright) plus **`next-auth@5` (Auth.js v5, beta)** in `apps/web`.

## Starting point — Phase 7a is COMPLETE

This plan builds directly on the 7a end-state. Treat the following as **already present** (do not re-implement):

- `packages/core` exports `interface Ctx { db: Db; userId: string }` and `const LOCAL_USER_ID = 'local-user'`.
- Every service method takes `(ctx, …)` and scopes reads/writes to `ctx.userId`; the cross-tenant isolation suite is green.
- `userService.upsertByGithubId(db, { githubId, email, name, avatarUrl }): User` (returns a row with `id`).
- `apiKeyService` — keys are **not** user-owned, so every method takes a bare `db` with the acting `userId` passed explicitly (7a signatures, verbatim):
  - `create(db, userId, name, now?): { apiKey: ApiKey; token: string }` — `token` is the plaintext, shown once; `apiKey` is the stored row (`id`, `name`, `createdAt`, `lastUsedAt`, **no** token). The REST layer maps this to the wire shape `{ raw: token, key: apiKey }`.
  - `listForUser(db, userId): ApiKey[]`
  - `revoke(db, userId, id): void`
  - `resolveToken(db, rawToken, now?): string | null` — SHA-256 hashes `rawToken`, looks up `api_keys.token_hash`, bumps `last_used_at`, returns `user_id` or `null`.
- `apps/api`: 7a introduced a typed Hono env and a **placeholder** identity middleware in `createApp` that does `c.set('ctx', { db, userId: LOCAL_USER_ID })`, and every route handler already reads `const ctx = c.var.ctx` and passes it to `core`. 7b **replaces the placeholder's body** with real resolution — route handlers do not change.
- `apps/mcp`: `registerTools(server, ctx)`, `registerResources(server, ctx)` already take a `Ctx`. `createMcpServer` currently takes a bare `db` and builds `{ db, userId: LOCAL_USER_ID }` internally; 7b changes it to accept a `Ctx`. This same `createMcpServer(ctx)` factory is reused by the key-gated `/mcp` route on `apps/api` (Task 9); the `apps/mcp` package keeps only its **stdio** entrypoint (local `local-user`).

> If any of the above is not literally true in the tree when you start (e.g. 7a hard-coded `local-user` inline in each route instead of via a `ctx` context var), first do a mechanical refactor to the `c.var.ctx` shape described here — it is a precondition, not part of a 7b task's scope.

## Global Constraints

- **Auth-resolution order is the single source of truth** (see §6 of the spec). Implement it exactly, in this order:
  1. Valid `X-Internal-Key` (`=== INTERNAL_API_SECRET`) ⇒ trust `X-User-Id` header. *(web proxy)*
  2. Else present `X-API-Key` ⇒ `apiKeyService.resolveToken(db, key)` ⇒ `userId` (null ⇒ `401`). *(agents/MCP/scripts)*
  3. Else `JUSTDOIT_MODE=local` (default when unset) ⇒ `local-user`.
  4. Else ⇒ `401`.
- **Zero-login local dev is non-negotiable.** With no `AUTH_GITHUB_ID` (and `JUSTDOIT_MODE` unset/`local`): web middleware is a no-op, the proxy stamps `local-user`, and the API resolves `local-user`. No sign-in screen ever appears locally.
- **The browser never holds a secret.** `INTERNAL_API_SECRET` lives only in server-side env (proxy, API). The session cookie is stripped before forwarding upstream.
- **API keys are shown once.** The plaintext `raw` is returned only from the create call; never persisted, never re-listed.
- New env vars introduced by 7b (all optional in local mode):
  - `apps/api`: `INTERNAL_API_SECRET`, `JUSTDOIT_MODE` (`local`|`hosted`).
  - `apps/web`: `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_ALLOWLIST`, `INTERNAL_API_URL`, `INTERNAL_API_SECRET`, and (hosted) `NEXT_PUBLIC_API_URL=/api/backend`. `JUSTDOIT_MODE` optionally to force hosted.
  - `apps/api`: also owns the key-gated `/mcp` route — no extra env beyond `INTERNAL_API_SECRET`/`JUSTDOIT_MODE` above (per-user MCP identity comes from the same resolution ladder).
  - `apps/mcp`: **local-stdio only** — no new hosted env. Its local HTTP entrypoint (if run) still reads `JUSTDOIT_MCP_PORT`; the old static `JUSTDOIT_API_KEY` gate is gone (hosted MCP is served by `apps/api/mcp`, resolved per-user).
- Vitest for `apps/api` runs node-only tsconfig ⇒ cast `await res.json()` results `as T`. `apps/web` uses RTL + jsdom for components and plain Vitest for pure `lib/*` helpers.
- Every task ends with a green `pnpm --filter <pkg> test` **and** `pnpm --filter <pkg> typecheck`, then a commit.

---

## File Structure (7b additions/edits)

```
apps/api/src/
├── context.ts                         # NEW/confirm: AppEnv = { Variables: { ctx: Ctx } }
├── app.ts                             # EDIT: mount internal routes, resolveUser, api-keys
├── middleware/auth.ts                 # EDIT: resolveUser (3-path resolver) replaces apiKeyAuth
├── middleware/auth.test.ts            # NEW: 4 resolution paths + 401
├── routes/internal.ts                 # NEW: POST /internal/users (X-Internal-Key gated)
├── routes/internal.test.ts            # NEW
├── routes/api-keys.ts                 # NEW: GET/POST/DELETE /api-keys (ctx-scoped)
├── routes/api-keys.test.ts            # NEW
├── routes/mcp.ts                      # NEW: key-gated /mcp streamable-HTTP (per-session ctx)
└── routes/mcp.test.ts                 # NEW

apps/web/src/
├── auth.ts                            # NEW: NextAuth() config → { handlers, auth, signIn, signOut }
├── lib/auth-config.ts                 # NEW: parseAllowlist/isAllowed/isAuthEnabled/shouldRedirect/resolveApiBase
├── lib/auth-config.test.ts            # NEW
├── lib/auth-callbacks.ts             # NEW: upsertUser + testable callback helpers
├── lib/auth-callbacks.test.ts        # NEW
├── types/next-auth.d.ts               # NEW: augment Session/JWT with userId
├── middleware.ts                      # NEW: protect routes (bypass in local mode)
├── middleware.test.ts                 # NEW
├── app/api/auth/[...nextauth]/route.ts# NEW: export { GET, POST } = handlers
├── app/api/backend/[...path]/route.ts # NEW: identity-injecting proxy
├── app/api/backend/[...path]/route.test.ts # NEW
├── app/signin/page.tsx                # NEW
├── app/settings/page.tsx              # NEW
├── components/api-keys-settings.tsx   # NEW
├── components/api-keys-settings.test.tsx # NEW
├── components/providers.tsx           # EDIT: wrap SessionProvider
├── hooks/use-api-keys.ts              # NEW
├── lib/api.ts                         # EDIT: api-keys methods + base via resolveApiBase
├── lib/schemas.ts                     # EDIT: apiKeySchema
├── lib/query-keys.ts                  # EDIT: apiKeys key
└── lib/api.test.ts                    # EDIT: base resolution

apps/mcp/src/                          # LOCAL-STDIO ONLY (no hosted service)
├── server.ts                          # EDIT: createMcpServer(ctx: Ctx) — reused by apps/api /mcp
└── stdio.ts                           # EDIT: build { db, userId: LOCAL_USER_ID } ctx
```

> The hosted, per-user MCP transport lives in `apps/api/src/routes/mcp.ts` (Task 9) — **not** in `apps/mcp`. `apps/mcp` keeps only its stdio entrypoint for local use.

---

## Task 1: API — `resolveUser` middleware (3-path identity) + `ctx` context var

**Files:**

- Confirm/Create: `apps/api/src/context.ts`
- Modify: `apps/api/src/middleware/auth.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/api/src/middleware/auth.test.ts`

**Interfaces:**

- Consumes: `apiKeyService.resolveToken`, `LOCAL_USER_ID`, `Ctx`, `Db` from `@justdoit/core`.
- Produces: `resolveUser(db, opts?): MiddlewareHandler<AppEnv>` that sets `c.var.ctx = { db, userId }` per the resolution order, or returns `401`. `createApp` wires it. `AppEnv = { Variables: { ctx: Ctx } }`.

- [ ] **Step 1: Confirm/write `apps/api/src/context.ts`**

```ts
import type { Ctx } from '@justdoit/core';

/** Hono per-request environment: every route reads `c.var.ctx`. */
export type AppEnv = { Variables: { ctx: Ctx } };
```

- [ ] **Step 2: Write the failing test — `apps/api/src/middleware/auth.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createDb, runMigrations, userService, apiKeyService, LOCAL_USER_ID } from '@justdoit/core';
import { resolveUser } from './auth';
import type { AppEnv } from '../context';

const SECRET = 'internal-secret';

function harness(mode: 'local' | 'hosted') {
  const { db } = createDb(':memory:');
  runMigrations(db);
  const app = new Hono<AppEnv>();
  app.use('*', resolveUser(db, { internalSecret: SECRET, mode }));
  app.get('/whoami', (c) => c.json({ userId: c.var.ctx.userId }));
  return { db, app };
}

describe('resolveUser', () => {
  it('path 1: valid internal key trusts X-User-Id', async () => {
    const { app } = harness('hosted');
    const res = await app.request('/whoami', {
      headers: { 'X-Internal-Key': SECRET, 'X-User-Id': 'user-A' },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { userId: string }).userId).toBe('user-A');
  });

  it('path 1: wrong internal key → 401', async () => {
    const { app } = harness('hosted');
    const res = await app.request('/whoami', {
      headers: { 'X-Internal-Key': 'nope', 'X-User-Id': 'user-A' },
    });
    expect(res.status).toBe(401);
  });

  it('path 2: valid X-API-Key resolves to its owner', async () => {
    const { db, app } = harness('hosted');
    const user = userService.upsertByGithubId(db, {
      githubId: 'gh1', email: 'a@x.dev', name: 'A', avatarUrl: null,
    });
    const { token } = apiKeyService.create(db, user.id, 'cli');
    const res = await app.request('/whoami', { headers: { 'X-API-Key': token } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { userId: string }).userId).toBe(user.id);
  });

  it('path 2: unknown X-API-Key → 401', async () => {
    const { app } = harness('hosted');
    const res = await app.request('/whoami', { headers: { 'X-API-Key': 'garbage' } });
    expect(res.status).toBe(401);
  });

  it('path 3: local mode with no headers → local-user', async () => {
    const { app } = harness('local');
    const res = await app.request('/whoami');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { userId: string }).userId).toBe(LOCAL_USER_ID);
  });

  it('path 4: hosted mode with no headers → 401', async () => {
    const { app } = harness('hosted');
    const res = await app.request('/whoami');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @justdoit/api test -- auth.test`
Expected: FAIL — `resolveUser` is not exported by `./auth`.

- [ ] **Step 4: Implement — replace `apps/api/src/middleware/auth.ts`**

```ts
import type { MiddlewareHandler } from 'hono';
import { apiKeyService, LOCAL_USER_ID, type Db } from '@justdoit/core';
import type { AppEnv } from '../context';

export interface ResolveUserOptions {
  /** Shared secret the web proxy sends as `X-Internal-Key`. */
  internalSecret?: string;
  /** `hosted` requires an identity; `local` falls back to the implicit user. */
  mode?: 'local' | 'hosted';
}

/**
 * Resolve the acting `userId` for every request and stash `ctx = { db, userId }`
 * for the routes. Resolution order (see Phase 7 spec §6):
 *   1. valid `X-Internal-Key` → trust `X-User-Id`   (the web proxy)
 *   2. present `X-API-Key`     → apiKeyService.resolveToken → userId | 401
 *   3. local mode              → LOCAL_USER_ID
 *   4. hosted, no identity     → 401
 */
export function resolveUser(db: Db, opts: ResolveUserOptions = {}): MiddlewareHandler<AppEnv> {
  const internalSecret = opts.internalSecret ?? process.env.INTERNAL_API_SECRET;
  const mode = opts.mode ?? (process.env.JUSTDOIT_MODE === 'hosted' ? 'hosted' : 'local');

  return async (c, next) => {
    const internalKey = c.req.header('X-Internal-Key');
    if (internalKey !== undefined) {
      if (!internalSecret || internalKey !== internalSecret) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      const userId = c.req.header('X-User-Id');
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);
      c.set('ctx', { db, userId });
      return next();
    }

    const apiKey = c.req.header('X-API-Key');
    if (apiKey !== undefined) {
      const userId = apiKeyService.resolveToken(db, apiKey);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);
      c.set('ctx', { db, userId });
      return next();
    }

    if (mode === 'local') {
      c.set('ctx', { db, userId: LOCAL_USER_ID });
      return next();
    }
    return c.json({ error: 'Unauthorized' }, 401);
  };
}
```

- [ ] **Step 5: Wire it in — modify `apps/api/src/app.ts`**

Replace the `apiKeyAuth` import/usage and CORS headers. The typed `Hono<AppEnv>`, health-before-auth ordering, and `resolveUser` registration matter:

```ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { startActivityLog, type Db } from '@justdoit/core';
import type { AppEnv } from './context';
import { errorHandler } from './middleware/error';
import { resolveUser } from './middleware/auth';
import { healthRoutes } from './routes/health';
// …existing route imports…

export interface CreateAppOptions {
  filesDir?: string;
  /** Shared secret for the trusted web proxy (`X-Internal-Key`). Defaults to `INTERNAL_API_SECRET`. */
  internalSecret?: string;
  /** `local` (default) or `hosted`. Defaults to `JUSTDOIT_MODE`. */
  mode?: 'local' | 'hosted';
  corsOrigin?: string | string[];
}

// …DEFAULT_CORS_ORIGINS / resolveCorsOrigin unchanged…

export function createApp(db: Db, opts: CreateAppOptions = {}): Hono<AppEnv> {
  startActivityLog(db);

  const app = new Hono<AppEnv>();
  app.onError(errorHandler);
  app.use(
    '*',
    cors({
      origin: resolveCorsOrigin(opts),
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'X-API-Key', 'X-Internal-Key', 'X-User-Id'],
    }),
  );

  // Public (no identity): health check for the platform load balancer.
  app.route('/', healthRoutes());
  // Server-to-server only (its own X-Internal-Key guard) — registered BEFORE
  // resolveUser so it isn't subject to the X-User-Id requirement.
  app.route('/internal', internalRoutes(db, { internalSecret: opts.internalSecret }));

  // Everything past here needs a resolved user.
  app.use('*', resolveUser(db, { internalSecret: opts.internalSecret, mode: opts.mode }));

  app.route('/projects', projectRoutes(db));
  // …all existing routes unchanged (they already read c.var.ctx)…
  app.route('/api-keys', apiKeyRoutes());
  const filesDir = opts.filesDir ?? process.env.JUSTDOIT_FILES_DIR ?? './data/files';
  app.route('/', attachmentRoutes(db, filesDir));
  return app;
}
```

> `internalRoutes` and `apiKeyRoutes` are added in Task 2; add their imports there. For this task, temporarily leave those two `app.route(...)` lines commented so `app.ts` typechecks, or land Tasks 1+2 together. Delete `apps/api/src/middleware/auth.ts`'s old `apiKeyAuth` export (nothing else references it after this edit — confirm with `grep -rn apiKeyAuth apps/api/src`).

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @justdoit/api test -- auth.test`
Expected: PASS — all six cases green.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @justdoit/api typecheck`
Expected: PASS (only after Task 2 lands the two new routers, or with them commented out).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(api): resolveUser middleware — internal-key/api-key/local identity"
```

---

## Task 2: API — `/api-keys` CRUD + internal `/internal/users` upsert

**Files:**

- Create: `apps/api/src/routes/api-keys.ts`
- Create: `apps/api/src/routes/api-keys.test.ts`
- Create: `apps/api/src/routes/internal.ts`
- Create: `apps/api/src/routes/internal.test.ts`
- Modify: `apps/api/src/app.ts` (uncomment/import the two routers from Task 1)

**Interfaces:**

- Consumes: `apiKeyService.{create,listForUser,revoke}`, `userService.upsertByGithubId`, `c.var.ctx`.
- Produces:
  - `GET /api-keys` → `{ keys: ApiKey[] }` (scoped to `ctx.userId`).
  - `POST /api-keys` `{ name }` → `201 { raw, key }` (raw shown once).
  - `DELETE /api-keys/:id` → `204`.
  - `POST /internal/users` (X-Internal-Key gated, **not** behind `resolveUser`) `{ githubId, email?, name?, avatarUrl? }` → `{ id }`.

- [ ] **Step 1: Write the failing test — `apps/api/src/routes/api-keys.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createDb, runMigrations, userService } from '@justdoit/core';
import { createApp } from '../app';

const SECRET = 'internal-secret';

function setup() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  const app = createApp(db, { mode: 'hosted', internalSecret: SECRET });
  const user = userService.upsertByGithubId(db, {
    githubId: 'gh1', email: 'a@x.dev', name: 'A', avatarUrl: null,
  });
  const asUser = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { 'X-Internal-Key': SECRET, 'X-User-Id': user.id, ...(init.headers ?? {}) },
    });
  return { db, app, user, asUser };
}

describe('api-keys routes', () => {
  it('creates (raw once), lists (no raw), and revokes a key', async () => {
    const { asUser } = setup();

    const created = await asUser('/api-keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'laptop' }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { raw: string; key: { id: string; name: string } };
    expect(body.raw).toMatch(/.{16,}/);
    expect(body.key.name).toBe('laptop');
    expect('token' in body.key).toBe(false);

    const listed = await asUser('/api-keys');
    const list = (await listed.json()) as { keys: Array<{ id: string; raw?: string }> };
    expect(list.keys).toHaveLength(1);
    expect(list.keys[0]!.raw).toBeUndefined();

    const del = await asUser(`/api-keys/${body.key.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    const afterList = (await (await asUser('/api-keys')).json()) as { keys: unknown[] };
    expect(afterList.keys).toHaveLength(0);
  });

  it('rejects a nameless create with 400', async () => {
    const { asUser } = setup();
    const res = await asUser('/api-keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Write the failing test — `apps/api/src/routes/internal.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createDb, runMigrations } from '@justdoit/core';
import { createApp } from '../app';

const SECRET = 'internal-secret';

function app() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return createApp(db, { mode: 'hosted', internalSecret: SECRET });
}

describe('internal user upsert', () => {
  it('upserts by github id (idempotent) with a valid internal key', async () => {
    const a = app();
    const post = (body: unknown) =>
      a.request('/internal/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Internal-Key': SECRET },
        body: JSON.stringify(body),
      });
    const r1 = await post({ githubId: '42', email: 'a@x.dev', name: 'A', avatarUrl: null });
    expect(r1.status).toBe(200);
    const { id } = (await r1.json()) as { id: string };
    const r2 = await post({ githubId: '42', email: 'a@x.dev', name: 'A2', avatarUrl: null });
    expect(((await r2.json()) as { id: string }).id).toBe(id);
  });

  it('rejects a wrong/missing internal key with 401', async () => {
    const res = await app().request('/internal/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Internal-Key': 'nope' },
      body: JSON.stringify({ githubId: '1' }),
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @justdoit/api test -- api-keys.test internal.test`
Expected: FAIL — routers/routes don't exist.

- [ ] **Step 4: Implement — `apps/api/src/routes/api-keys.ts`**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { apiKeyService } from '@justdoit/core';
import type { AppEnv } from '../context';

const createKeySchema = z.object({ name: z.string().min(1).max(100) });

export function apiKeyRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/', (c) => {
    const { db, userId } = c.var.ctx;
    return c.json({ keys: apiKeyService.listForUser(db, userId) });
  });

  r.post('/', zValidator('json', createKeySchema), (c) => {
    const { db, userId } = c.var.ctx;
    // core returns { apiKey, token }; the wire shape shows the plaintext once as `raw`.
    const { apiKey, token } = apiKeyService.create(db, userId, c.req.valid('json').name);
    return c.json({ raw: token, key: apiKey }, 201);
  });

  r.delete('/:id', (c) => {
    const { db, userId } = c.var.ctx;
    apiKeyService.revoke(db, userId, c.req.param('id'));
    return c.body(null, 204);
  });

  return r;
}
```

- [ ] **Step 5: Implement — `apps/api/src/routes/internal.ts`**

```ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { userService, type Db } from '@justdoit/core';

const upsertUserSchema = z.object({
  githubId: z.string().min(1),
  email: z.string().email().nullish(),
  name: z.string().nullish(),
  avatarUrl: z.string().url().nullish(),
});

/**
 * Server-to-server surface reached only by the web app during sign-in, before a
 * session `userId` exists. Guarded by its own `X-Internal-Key` check and mounted
 * OUTSIDE `resolveUser` (which would demand an `X-User-Id` it cannot yet supply).
 */
export function internalRoutes(db: Db, opts: { internalSecret?: string } = {}): Hono {
  const secret = opts.internalSecret ?? process.env.INTERNAL_API_SECRET;
  const r = new Hono();

  r.use('*', async (c, next) => {
    if (!secret || c.req.header('X-Internal-Key') !== secret) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return next();
  });

  r.post('/users', zValidator('json', upsertUserSchema), (c) => {
    const input = c.req.valid('json');
    const user = userService.upsertByGithubId(db, {
      githubId: input.githubId,
      email: input.email ?? null,
      name: input.name ?? null,
      avatarUrl: input.avatarUrl ?? null,
    });
    return c.json({ id: user.id });
  });

  return r;
}
```

- [ ] **Step 6: Import both routers in `apps/api/src/app.ts`**

Add `import { apiKeyRoutes } from './routes/api-keys';` and `import { internalRoutes } from './routes/internal';`, and uncomment the two `app.route(...)` lines from Task 1.

- [ ] **Step 7: Run to verify pass**

Run: `pnpm --filter @justdoit/api test -- api-keys.test internal.test`
Expected: PASS.

- [ ] **Step 8: Full API gate + commit**

Run: `pnpm --filter @justdoit/api test && pnpm --filter @justdoit/api typecheck`
Expected: PASS (all pre-existing route tests still green — they run in default `local` mode, so `resolveUser` stamps `local-user` exactly as the 7a placeholder did).

```bash
git add -A
git commit -m "feat(api): per-user /api-keys CRUD + internal user upsert endpoint"
```

---

## Task 3: Web — auth/config helpers (pure, testable)

**Files:**

- Modify: `apps/web/package.json` (add `next-auth`)
- Create: `apps/web/src/lib/auth-config.ts`
- Create: `apps/web/src/lib/auth-config.test.ts`

**Interfaces:**

- Consumes: `process.env`.
- Produces pure helpers reused by middleware, the proxy, and the API client:
  - `isAuthEnabled(env?): boolean` — true iff `JUSTDOIT_MODE=hosted` or `AUTH_GITHUB_ID` present.
  - `parseAllowlist(raw?): string[]` — lowercased, trimmed, comma-split, empties dropped.
  - `isAllowed(allowlist, { email?, login? }): boolean` — fail-closed on an empty allowlist.
  - `shouldRedirect(pathname, hasSession, authEnabled): boolean` — the middleware's decision, extracted for testing.
  - `resolveApiBase(env?): string` — `NEXT_PUBLIC_API_URL ?? 'http://localhost:8787'`, trailing slash stripped.

- [ ] **Step 1: Add the dependency — `apps/web/package.json`**

Add to `dependencies`: `"next-auth": "^5.0.0-beta.25"`. Then:

Run: `pnpm install`
Expected: resolves and installs `next-auth`; no peer-dependency errors against `next@15`/`react@19`.

- [ ] **Step 2: Write the failing test — `apps/web/src/lib/auth-config.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  isAuthEnabled,
  parseAllowlist,
  isAllowed,
  shouldRedirect,
  resolveApiBase,
} from './auth-config';

describe('auth-config', () => {
  it('isAuthEnabled: hosted mode or GitHub id enables auth', () => {
    expect(isAuthEnabled({})).toBe(false);
    expect(isAuthEnabled({ JUSTDOIT_MODE: 'hosted' })).toBe(true);
    expect(isAuthEnabled({ AUTH_GITHUB_ID: 'abc' })).toBe(true);
  });

  it('parseAllowlist: trims, lowercases, drops empties', () => {
    expect(parseAllowlist(' A@x.dev , octocat ,')).toEqual(['a@x.dev', 'octocat']);
    expect(parseAllowlist(undefined)).toEqual([]);
  });

  it('isAllowed: matches email or login, fails closed when empty', () => {
    const list = ['a@x.dev', 'octocat'];
    expect(isAllowed(list, { email: 'A@x.dev' })).toBe(true);
    expect(isAllowed(list, { login: 'Octocat' })).toBe(true);
    expect(isAllowed(list, { email: 'b@x.dev' })).toBe(false);
    expect(isAllowed([], { email: 'a@x.dev' })).toBe(false);
  });

  it('shouldRedirect: only when auth on, no session, non-public path', () => {
    expect(shouldRedirect('/tasks', false, true)).toBe(true);
    expect(shouldRedirect('/tasks', true, true)).toBe(false);
    expect(shouldRedirect('/signin', false, true)).toBe(false);
    expect(shouldRedirect('/api/auth/callback', false, true)).toBe(false);
    expect(shouldRedirect('/tasks', false, false)).toBe(false);
  });

  it('resolveApiBase: env or localhost, trailing slash stripped', () => {
    expect(resolveApiBase({})).toBe('http://localhost:8787');
    expect(resolveApiBase({ NEXT_PUBLIC_API_URL: '/api/backend/' })).toBe('/api/backend');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @justdoit/web test -- auth-config`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement — `apps/web/src/lib/auth-config.ts`**

```ts
type Env = Record<string, string | undefined>;

export function isAuthEnabled(env: Env = process.env): boolean {
  return env.JUSTDOIT_MODE === 'hosted' || Boolean(env.AUTH_GITHUB_ID);
}

export function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(
  allowlist: string[],
  identity: { email?: string | null; login?: string | null },
): boolean {
  if (allowlist.length === 0) return false; // fail closed
  const email = identity.email?.toLowerCase();
  const login = identity.login?.toLowerCase();
  return (!!email && allowlist.includes(email)) || (!!login && allowlist.includes(login));
}

const PUBLIC_PREFIXES = ['/signin', '/not-allowed', '/api/auth'];

export function shouldRedirect(pathname: string, hasSession: boolean, authEnabled: boolean): boolean {
  if (!authEnabled || hasSession) return false;
  return !PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

export function resolveApiBase(env: Env = process.env): string {
  const base = env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';
  return base.replace(/\/$/, '');
}
```

- [ ] **Step 5: Run to verify pass + typecheck**

Run: `pnpm --filter @justdoit/web test -- auth-config && pnpm --filter @justdoit/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): add next-auth dep and pure auth/config helpers"
```

---

## Task 4: Web — Auth.js config (GitHub, allowlist, upsert→userId session)

**Files:**

- Create: `apps/web/src/lib/auth-callbacks.ts`
- Create: `apps/web/src/lib/auth-callbacks.test.ts`
- Create: `apps/web/src/auth.ts`
- Create: `apps/web/src/types/next-auth.d.ts`
- Create: `apps/web/src/app/api/auth/[...nextauth]/route.ts`

**Interfaces:**

- Consumes: `parseAllowlist`, `isAllowed`; env `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_ALLOWLIST`, `INTERNAL_API_URL`, `INTERNAL_API_SECRET`.
- Produces:
  - `upsertUser(fetchFn, { base, secret }, profile): Promise<string>` — POSTs to `${base}/internal/users` with `X-Internal-Key`, returns the `id`.
  - `apps/web/src/auth.ts` exporting `{ handlers, auth, signIn, signOut }` from `NextAuth(...)` with the GitHub provider, the allowlist `signIn` gate, a `jwt` callback that upserts + stores `userId`, and a `session` callback that exposes `session.user.id`.
  - The `/api/auth/[...nextauth]` route handler.

- [ ] **Step 1: Write the failing test — `apps/web/src/lib/auth-callbacks.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { upsertUser } from './auth-callbacks';

describe('upsertUser', () => {
  it('POSTs to the internal endpoint with the shared secret and returns id', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'user-123' }), { status: 200 }),
    );
    const id = await upsertUser(fetchFn as unknown as typeof fetch, {
      base: 'http://api.internal',
      secret: 's3cret',
    }, { githubId: '42', email: 'a@x.dev', name: 'A', avatarUrl: null });

    expect(id).toBe('user-123');
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('http://api.internal/internal/users');
    expect((init as RequestInit).method).toBe('POST');
    expect((init!.headers as Record<string, string>)['X-Internal-Key']).toBe('s3cret');
  });

  it('throws on a non-OK upstream response', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(
      upsertUser(fetchFn as unknown as typeof fetch, { base: 'http://api', secret: 's' }, {
        githubId: '1', email: null, name: null, avatarUrl: null,
      }),
    ).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @justdoit/web test -- auth-callbacks`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement — `apps/web/src/lib/auth-callbacks.ts`**

```ts
export interface GithubProfile {
  githubId: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export async function upsertUser(
  fetchFn: typeof fetch,
  cfg: { base: string; secret: string },
  profile: GithubProfile,
): Promise<string> {
  const res = await fetchFn(`${cfg.base}/internal/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Internal-Key': cfg.secret },
    body: JSON.stringify(profile),
  });
  if (!res.ok) throw new Error(`user upsert failed: ${res.status}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @justdoit/web test -- auth-callbacks`
Expected: PASS.

- [ ] **Step 5: Implement — `apps/web/src/auth.ts`**

```ts
import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { parseAllowlist, isAllowed } from '@/lib/auth-config';
import { upsertUser } from '@/lib/auth-callbacks';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub], // reads AUTH_GITHUB_ID / AUTH_GITHUB_SECRET automatically
  session: { strategy: 'jwt' },
  pages: { signIn: '/signin', error: '/signin' },
  callbacks: {
    signIn({ profile }) {
      const allowlist = parseAllowlist(process.env.AUTH_ALLOWLIST);
      return isAllowed(allowlist, {
        email: (profile?.email as string | null) ?? null,
        login: (profile?.login as string | null) ?? null,
      });
    },
    async jwt({ token, account, profile }) {
      // account+profile are present only on the initial sign-in event.
      if (account && profile) {
        const base = process.env.INTERNAL_API_URL;
        const secret = process.env.INTERNAL_API_SECRET;
        if (!base || !secret) throw new Error('INTERNAL_API_URL/INTERNAL_API_SECRET missing');
        token.userId = await upsertUser(fetch, { base, secret }, {
          githubId: String(profile.id),
          email: (profile.email as string | null) ?? null,
          name: (profile.name as string | null) ?? null,
          avatarUrl: (profile.avatar_url as string | null) ?? null,
        });
      }
      return token;
    },
    session({ session, token }) {
      if (token.userId && session.user) session.user.id = token.userId;
      return session;
    },
  },
});
```

- [ ] **Step 6: Type augmentation — `apps/web/src/types/next-auth.d.ts`**

```ts
import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: { id?: string } & import('next-auth').DefaultSession['user'];
  }
}
declare module 'next-auth/jwt' {
  interface JWT {
    userId?: string;
  }
}
```

- [ ] **Step 7: Route handler — `apps/web/src/app/api/auth/[...nextauth]/route.ts`**

```ts
import { handlers } from '@/auth';

export const { GET, POST } = handlers;
```

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @justdoit/web typecheck`
Expected: PASS — `session.user.id` and `token.userId` resolve via the augmentation.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(web): Auth.js GitHub provider with allowlist gate and userId session"
```

---

## Task 5: Web — route protection middleware, sign-in & not-allowed pages, SessionProvider

**Files:**

- Create: `apps/web/src/middleware.ts`
- Create: `apps/web/src/middleware.test.ts`
- Create: `apps/web/src/app/signin/page.tsx`
- Create: `apps/web/src/app/not-allowed/page.tsx`
- Modify: `apps/web/src/components/providers.tsx` (wrap `SessionProvider`)

**Interfaces:**

- Consumes: `auth`, `isAuthEnabled`, `shouldRedirect`.
- Produces: middleware that (a) is a no-op when auth is disabled (local zero-login) and (b) redirects unauthenticated requests to `/signin` in hosted mode; a client sign-in page with a "Continue with GitHub" button and an allowlist-rejection message when `?error=AccessDenied`; a not-allowed page; `SessionProvider` in the tree.

- [ ] **Step 1: Write the failing test — `apps/web/src/middleware.test.ts`**

Test the local-mode bypass concretely (no env ⇒ `next()`), which needs no session machinery:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

describe('middleware (local mode bypass)', () => {
  const prev = { ...process.env };
  beforeEach(() => {
    delete process.env.JUSTDOIT_MODE;
    delete process.env.AUTH_GITHUB_ID;
  });
  afterEach(() => {
    process.env = { ...prev };
    vi.resetModules();
  });

  it('does not redirect when auth is disabled', async () => {
    const { default: middleware } = await import('./middleware');
    const res = await middleware(new NextRequest('http://localhost:3000/tasks'));
    // NextResponse.next() ⇒ no redirect Location header
    expect(res.headers.get('location')).toBeNull();
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @justdoit/web test -- middleware`
Expected: FAIL — `./middleware` not found.

- [ ] **Step 3: Implement — `apps/web/src/middleware.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { isAuthEnabled, shouldRedirect } from '@/lib/auth-config';

export default async function middleware(req: NextRequest): Promise<NextResponse> {
  if (!isAuthEnabled()) return NextResponse.next(); // local: zero-login

  // Import lazily so the local path never initializes Auth.js.
  const { auth } = await import('@/auth');
  const session = await auth();
  if (shouldRedirect(req.nextUrl.pathname, Boolean(session?.user?.id), true)) {
    const url = req.nextUrl.clone();
    url.pathname = '/signin';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Exclude static assets + the auth API from the matcher.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|ico)$).*)'],
};
```

- [ ] **Step 4: Implement — `apps/web/src/app/signin/page.tsx`**

```tsx
'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

export default function SignInPage(): React.ReactNode {
  const error = useSearchParams().get('error');
  const rejected = error === 'AccessDenied';
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">justdoit</h1>
      {rejected && (
        <p role="alert" className="max-w-sm text-center text-sm text-destructive">
          That GitHub account isn’t on the allowlist. Ask the owner to add your email or login.
        </p>
      )}
      <Button onClick={() => void signIn('github', { callbackUrl: '/' })}>
        Continue with GitHub
      </Button>
    </main>
  );
}
```

- [ ] **Step 5: Implement — `apps/web/src/app/not-allowed/page.tsx`**

```tsx
export default function NotAllowedPage(): React.ReactNode {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-xl font-semibold">Access not allowed</h1>
      <p className="text-sm text-muted-foreground">
        Your account isn’t on the allowlist for this instance.
      </p>
    </main>
  );
}
```

- [ ] **Step 6: Wrap `SessionProvider` — modify `apps/web/src/components/providers.tsx`**

Add `import { SessionProvider } from 'next-auth/react';` and wrap the existing tree:

```tsx
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        {/* …existing QueryClientProvider / LiveSync / TooltipProvider… */}
      </ThemeProvider>
    </SessionProvider>
```

- [ ] **Step 7: Run to verify pass + typecheck**

Run: `pnpm --filter @justdoit/web test -- middleware && pnpm --filter @justdoit/web typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(web): route-protection middleware, sign-in/not-allowed pages, SessionProvider"
```

---

## Task 6: Web — identity-injecting `/api/backend/[...path]` proxy

**Files:**

- Create: `apps/web/src/app/api/backend/[...path]/route.ts`
- Create: `apps/web/src/app/api/backend/[...path]/route.test.ts`

**Interfaces:**

- Consumes: `auth`, `isAuthEnabled`; env `INTERNAL_API_URL`, `INTERNAL_API_SECRET`.
- Produces: a Node-runtime catch-all handling `GET/POST/PATCH/PUT/DELETE/HEAD` that verifies the session (hosted) or falls back to `local-user`, forwards to `${INTERNAL_API_URL}/<path><search>` with `X-User-Id` + `X-Internal-Key` (cookie stripped), streams the request body (JSON + multipart) with `duplex: 'half'`, and streams the upstream response body straight back (JSON + attachment downloads + SSE `/events`).

- [ ] **Step 1: Write the failing test — `apps/web/src/app/api/backend/[...path]/route.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'user-A' } })) }));

describe('backend proxy', () => {
  const prev = { ...process.env };
  beforeEach(() => {
    process.env.JUSTDOIT_MODE = 'hosted';
    process.env.INTERNAL_API_URL = 'http://api.internal:8787';
    process.env.INTERNAL_API_SECRET = 's3cret';
  });
  afterEach(() => {
    process.env = { ...prev };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('forwards to the internal API with X-User-Id and X-Internal-Key', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    const { GET } = await import('./route');

    const req = new NextRequest('http://localhost:3000/api/backend/tasks?status=todo');
    const res = await GET(req, { params: Promise.resolve({ path: ['tasks'] }) });

    expect(res.status).toBe(200);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://api.internal:8787/tasks?status=todo');
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('X-User-Id')).toBe('user-A');
    expect(headers.get('X-Internal-Key')).toBe('s3cret');
    expect(headers.get('cookie')).toBeNull();
  });

  it('returns 401 when hosted and there is no session', async () => {
    const authMod = await import('@/auth');
    (authMod.auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost:3000/api/backend/tasks'), {
      params: Promise.resolve({ path: ['tasks'] }),
    });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @justdoit/web test -- backend`
Expected: FAIL — `./route` not found.

- [ ] **Step 3: Implement — `apps/web/src/app/api/backend/[...path]/route.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';
import { isAuthEnabled } from '@/lib/auth-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STRIP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host', 'content-length', 'cookie',
]);

async function handler(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const base = process.env.INTERNAL_API_URL;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!base || !secret) {
    return NextResponse.json({ error: 'proxy not configured' }, { status: 500 });
  }

  let userId = 'local-user';
  if (isAuthEnabled()) {
    const session = await auth();
    const id = session?.user?.id;
    if (!id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    userId = id;
  }

  const { path } = await ctx.params;
  const target = `${base}/${path.join('/')}${req.nextUrl.search}`;

  const headers = new Headers(req.headers);
  for (const h of STRIP) headers.delete(h);
  headers.set('X-User-Id', userId);
  headers.set('X-Internal-Key', secret);

  const init: RequestInit & { duplex?: 'half' } = { method: req.method, headers, redirect: 'manual' };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body;
    init.duplex = 'half'; // required to stream a request body through Node's fetch
  }

  const upstream = await fetch(target, init);
  const respHeaders = new Headers(upstream.headers);
  for (const h of STRIP) respHeaders.delete(h);
  // Passing through `upstream.body` (a ReadableStream) streams JSON, file
  // downloads, and SSE (/events) without buffering.
  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
export const HEAD = handler;
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @justdoit/web test -- backend`
Expected: PASS — both cases green.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @justdoit/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(web): identity-injecting /api/backend proxy (JSON, multipart, SSE)"
```

---

## Task 7: Web — point the API client at the proxy in hosted mode

**Files:**

- Modify: `apps/web/src/lib/api.ts` (base via `resolveApiBase`)
- Modify: `apps/web/src/lib/api.test.ts` (base resolution)

**Interfaces:**

- Consumes: `resolveApiBase`.
- Produces: `getBaseUrl()`/`apiUrl()` return `NEXT_PUBLIC_API_URL` when set (hosted: `/api/backend` — same-origin, relative-safe for `fetch`, `EventSource`, and `<a>`), else `http://localhost:8787` (local, direct). No client change beyond base sourcing; the proxy and the direct API both accept the same paths.

- [ ] **Step 1: Add the failing assertions — append to `apps/web/src/lib/api.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { resolveApiBase } from './auth-config';

describe('api base resolution', () => {
  const prev = process.env.NEXT_PUBLIC_API_URL;
  afterEach(() => {
    if (prev === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = prev;
  });

  it('local default', () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    expect(resolveApiBase()).toBe('http://localhost:8787');
  });

  it('hosted proxy base (relative, same-origin)', () => {
    process.env.NEXT_PUBLIC_API_URL = '/api/backend';
    expect(resolveApiBase()).toBe('/api/backend');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @justdoit/web test -- api.test`
Expected: FAIL — the new `describe` fails only if `resolveApiBase` isn't imported/used; if `auth-config` already exists (Task 3) this passes immediately, so first assert the client actually routes through it (Step 3), then re-run.

- [ ] **Step 3: Implement — modify `apps/web/src/lib/api.ts`**

Replace the local `getBaseUrl` with the shared helper so hosted/local switch lives in one place:

```ts
import { resolveApiBase } from './auth-config';

function getBaseUrl(): string {
  return resolveApiBase();
}
```

Leave `apiUrl()`, `request()`, and `uploadAttachment()` untouched — they already build `${getBaseUrl()}${path}`, which yields correct same-origin relative URLs (`/api/backend/events`, `/api/backend/tasks/:id/attachments`) under the proxy. Note: `NEXT_PUBLIC_API_KEY` stays unset in hosted mode (identity comes from the proxy, not the browser), so the existing `X-API-Key` injection in `request()` is inert there.

- [ ] **Step 4: Run full web test + typecheck**

Run: `pnpm --filter @justdoit/web test && pnpm --filter @justdoit/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): source API base from resolveApiBase (proxy in hosted mode)"
```

---

## Task 8: Web — per-user API-key Settings screen

**Files:**

- Modify: `apps/web/src/lib/schemas.ts` (`apiKeySchema` + type)
- Modify: `apps/web/src/lib/api.ts` (`listApiKeys`/`createApiKey`/`revokeApiKey`)
- Modify: `apps/web/src/lib/query-keys.ts` (`apiKeys` key)
- Create: `apps/web/src/hooks/use-api-keys.ts`
- Create: `apps/web/src/components/api-keys-settings.tsx`
- Create: `apps/web/src/components/api-keys-settings.test.tsx`
- Create: `apps/web/src/app/settings/page.tsx`

**Interfaces:**

- Consumes: the `/api-keys` REST endpoints (Task 2) through the client.
- Produces: `api.listApiKeys()`, `api.createApiKey(name)` (→ `{ raw, key }`), `api.revokeApiKey(id)`; a `useApiKeys()` hook (TanStack Query list + create/revoke mutations); an `ApiKeysSettings` component that creates a key, shows the plaintext **once** in a copyable panel, lists existing keys, and revokes; a `/settings` page rendering it.

- [ ] **Step 1: Add the schema — `apps/web/src/lib/schemas.ts`**

```ts
export const apiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.coerce.date(),
  lastUsedAt: z.coerce.date().nullable(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;
```

- [ ] **Step 2: Add client methods — `apps/web/src/lib/api.ts`**

```ts
import { apiKeySchema, type ApiKey } from './schemas';
export type { ApiKey };

async function listApiKeys(): Promise<ApiKey[]> {
  const data = await request<{ keys: unknown[] }>('/api-keys');
  return data.keys.map((k) => parseTolerant(apiKeySchema, k, 'apiKey'));
}
async function createApiKey(name: string): Promise<{ raw: string; key: ApiKey }> {
  const data = await request<{ raw: string; key: unknown }>('/api-keys', {
    method: 'POST',
    body: json({ name }),
  });
  return { raw: data.raw, key: parseTolerant(apiKeySchema, data.key, 'apiKey') };
}
async function revokeApiKey(id: string): Promise<void> {
  await request<void>(`/api-keys/${id}`, { method: 'DELETE' });
}
```

Add `listApiKeys, createApiKey, revokeApiKey` to the exported `api` object.

- [ ] **Step 3: Query key — `apps/web/src/lib/query-keys.ts`**

Add `apiKeys: ['api-keys'] as const` to the keys map.

- [ ] **Step 4: Hook — `apps/web/src/hooks/use-api-keys.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ApiKey } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useApiKeys() {
  const qc = useQueryClient();
  const list = useQuery<ApiKey[]>({ queryKey: queryKeys.apiKeys, queryFn: api.listApiKeys });
  const create = useMutation({
    mutationFn: (name: string) => api.createApiKey(name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.apiKeys }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.apiKeys }),
  });
  return { list, create, revoke };
}
```

- [ ] **Step 5: Write the failing test — `apps/web/src/components/api-keys-settings.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ApiKeysSettings } from './api-keys-settings';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('ApiKeysSettings', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listApiKeys').mockResolvedValue([
      { id: 'k1', name: 'laptop', createdAt: new Date(), lastUsedAt: null },
    ]);
    vi.spyOn(api, 'createApiKey').mockResolvedValue({
      raw: 'jdi_live_ABC123SECRET',
      key: { id: 'k2', name: 'ci', createdAt: new Date(), lastUsedAt: null },
    });
    vi.spyOn(api, 'revokeApiKey').mockResolvedValue(undefined);
  });

  it('lists existing keys', async () => {
    wrap(<ApiKeysSettings />);
    expect(await screen.findByText('laptop')).toBeInTheDocument();
  });

  it('creates a key and shows the raw token exactly once', async () => {
    wrap(<ApiKeysSettings />);
    await userEvent.type(await screen.findByLabelText(/key name/i), 'ci');
    await userEvent.click(screen.getByRole('button', { name: /create key/i }));
    expect(await screen.findByText('jdi_live_ABC123SECRET')).toBeInTheDocument();
    expect(api.createApiKey).toHaveBeenCalledWith('ci');
  });

  it('revokes a key', async () => {
    wrap(<ApiKeysSettings />);
    await screen.findByText('laptop');
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }));
    await waitFor(() => expect(api.revokeApiKey).toHaveBeenCalledWith('k1'));
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `pnpm --filter @justdoit/web test -- api-keys-settings`
Expected: FAIL — component not found.

- [ ] **Step 7: Implement — `apps/web/src/components/api-keys-settings.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useApiKeys } from '@/hooks/use-api-keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function ApiKeysSettings(): React.ReactNode {
  const { list, create, revoke } = useApiKeys();
  const [name, setName] = useState('');
  const [freshRaw, setFreshRaw] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim()) return;
    const { raw } = await create.mutateAsync(name.trim());
    setFreshRaw(raw);
    setName('');
  }

  return (
    <section className="space-y-6">
      <form onSubmit={onCreate} className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Key name
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="laptop" />
        </label>
        <Button type="submit" disabled={create.isPending}>Create key</Button>
      </form>

      {freshRaw && (
        <div role="status" className="rounded-md border border-border bg-muted p-3 text-sm">
          <p className="mb-1 font-medium">Copy this now — it won’t be shown again:</p>
          <code className="break-all">{freshRaw}</code>
        </div>
      )}

      <ul className="divide-y divide-border">
        {(list.data ?? []).map((k) => (
          <li key={k.id} className="flex items-center justify-between py-2">
            <span>{k.name}</span>
            <Button variant="ghost" size="sm" onClick={() => void revoke.mutate(k.id)}>
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 8: Page — `apps/web/src/app/settings/page.tsx`**

```tsx
import { ApiKeysSettings } from '@/components/api-keys-settings';

export default function SettingsPage(): React.ReactNode {
  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div>
        <h2 className="mb-4 text-lg font-medium">API keys</h2>
        <ApiKeysSettings />
      </div>
    </main>
  );
}
```

- [ ] **Step 9: Run to verify pass + typecheck**

Run: `pnpm --filter @justdoit/web test -- api-keys-settings && pnpm --filter @justdoit/web typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(web): per-user API-key settings (create once, list, revoke)"
```

---

## Task 9: API — key-gated `/mcp` streamable-HTTP route (+ `apps/mcp` stays local stdio)

Per the Phase 7 design (D1), the hosted MCP surface is **served by `apps/api`** at `/mcp`, not a separate service. It sits behind the same `resolveUser` middleware (Task 1), so `c.var.ctx.userId` is already the key's owner (path 2: `X-API-Key`) or `local-user` (local mode). The route reuses the `createMcpServer(ctx)` factory from `@justdoit/mcp`. The standalone `apps/mcp` package keeps only its **stdio** entrypoint for local use.

**Files:**

- Modify: `apps/mcp/src/server.ts` (`createMcpServer(ctx: Ctx)`)
- Modify: `apps/mcp/src/stdio.ts` (build local `ctx`)
- Delete/retire: `apps/mcp/src/http.ts` and `apps/mcp/src/__tests__/http.test.ts` (the hosted transport moves to `apps/api`)
- Modify: `apps/api/package.json` (add `@justdoit/mcp` workspace dependency)
- Create: `apps/api/src/routes/mcp.ts` (key-gated `/mcp` streamable-HTTP; per-session ctx from `c.var.ctx`)
- Create: `apps/api/src/routes/mcp.test.ts` (key→user paths + 401)
- Modify: `apps/api/src/app.ts` (mount `/mcp` **after** `resolveUser`)

**Interfaces:**

- Consumes: `createMcpServer` from `@justdoit/mcp`; `c.var.ctx` (already resolved by `resolveUser`); `Ctx`, `Db`.
- Produces:
  - `createMcpServer(ctx: Ctx): McpServer` (accepts a `Ctx` instead of a bare `db`).
  - A `/mcp` route on `apps/api` that, on `initialize`, mints a per-session `StreamableHTTPServerTransport` bound to a server built from `c.var.ctx` (i.e. the `X-API-Key` owner in hosted mode, or `local-user` in local mode). No key in hosted mode ⇒ `resolveUser` already returned `401` upstream.
  - A stdio entrypoint (`apps/mcp/src/stdio.ts`) using `{ db, userId: LOCAL_USER_ID }`.

- [ ] **Step 1: Write the failing test — `apps/api/src/routes/mcp.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createDb, runMigrations, userService, apiKeyService } from '@justdoit/core';
import { createApp } from '../app';

const SECRET = 'internal-secret';

function seedKey() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  const user = userService.upsertByGithubId(db, {
    githubId: 'gh1', email: 'a@x.dev', name: 'A', avatarUrl: null,
  });
  const { token } = apiKeyService.create(db, user.id, 'agent'); // 7a signature: (db, userId, name)
  return { db, user, token };
}

const initBody = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 's', version: '0' } },
});
const headers = (extra: Record<string, string> = {}) => ({
  'content-type': 'application/json', accept: 'application/json, text/event-stream', ...extra,
});

describe('POST /mcp identity', () => {
  it('hosted mode: initialize without a key → 401 (resolveUser blocks it)', async () => {
    const { db } = seedKey();
    const app = createApp(db, { mode: 'hosted', internalSecret: SECRET });
    const res = await app.request('/mcp', { method: 'POST', headers: headers(), body: initBody });
    expect(res.status).toBe(401);
  });

  it('hosted mode: a valid X-API-Key initializes a session bound to its owner', async () => {
    const { db, token } = seedKey();
    const app = createApp(db, { mode: 'hosted', internalSecret: SECRET });
    const res = await app.request('/mcp', {
      method: 'POST', headers: headers({ 'X-API-Key': token }), body: initBody,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeTruthy();
  });

  it('local mode: no key → local-user session', async () => {
    const { db } = seedKey();
    const app = createApp(db, { mode: 'local' });
    const res = await app.request('/mcp', { method: 'POST', headers: headers(), body: initBody });
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeTruthy();
  });
});
```

> The assertions that matter: `401` when hosted+keyless (enforced by `resolveUser`, Task 1), vs. a returned `mcp-session-id` bound to the resolved user.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @justdoit/api test -- mcp.test`
Expected: FAIL — the `/mcp` route does not exist yet.

- [ ] **Step 3: Implement — `apps/mcp/src/server.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Ctx } from '@justdoit/core';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';

export function createMcpServer(ctx: Ctx): McpServer {
  const server = new McpServer({ name: 'justdoit', version: '0.0.0' });
  registerTools(server, ctx);
  registerResources(server, ctx);
  registerPrompts(server);
  return server;
}
```

- [ ] **Step 4: Implement — `apps/api/src/routes/mcp.ts`**

Identity is **already resolved** by `resolveUser` (Task 1): a keyless hosted request 401s before reaching here, and `c.var.ctx.userId` is the `X-API-Key` owner (or `local-user`). So the route only manages per-session transports, binding each new session's MCP server to the request's `c.var.ctx`. It reuses `createMcpServer(ctx)` from `@justdoit/mcp` and bridges Hono to the SDK's `StreamableHTTPServerTransport` via the Node request/response (`@hono/node-server`'s `c.env`).

```ts
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '@justdoit/mcp'; // the shared factory (Task 9 Step 3)
import type { AppEnv } from '../context';

export function mcpRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const transports = new Map<string, StreamableHTTPServerTransport>();

  r.all('/', async (c) => {
    const { req: nodeReq, res: nodeRes } = c.env.incoming
      ? { req: c.env.incoming, res: c.env.outgoing } // node-server adapter
      : (() => { throw new Error('/mcp requires the Node server adapter'); })();

    const sessionId = c.req.header('mcp-session-id');
    const body = c.req.method === 'POST' ? await c.req.json().catch(() => undefined) : undefined;

    // A new session (initialize, no session id) binds a server to the resolved user.
    if (!sessionId && isInitializeRequest(body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => transports.set(id, transport),
      });
      transport.onclose = () => { if (transport.sessionId) transports.delete(transport.sessionId); };
      const server = createMcpServer(c.var.ctx); // session bound to the X-API-Key owner
      await server.connect(transport);
      await transport.handleRequest(nodeReq, nodeRes, body);
      return RESPONSE_ALREADY_SENT; // the transport writes to nodeRes directly
    }

    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) return c.json({ jsonrpc: '2.0', error: { code: -32000, message: 'no valid session' }, id: null }, 400);
    await transport.handleRequest(nodeReq, nodeRes, body);
    return RESPONSE_ALREADY_SENT;
  });

  return r;
}
```

> The exact Hono↔Node bridge mirrors the session-manager logic that previously lived in `apps/mcp/src/http.ts`; it now reads identity from `c.var.ctx` instead of resolving the key itself (`resolveUser` did that upstream). Use Hono's `RESPONSE_ALREADY_SENT` sentinel (or a streamed body) so Hono doesn't double-send.

- [ ] **Step 4b: Mount it — `apps/api/src/app.ts`**

Add `import { mcpRoutes } from './routes/mcp';` and mount it **after** `resolveUser` (so `/mcp` is auth-gated exactly like the REST routes): `app.route('/mcp', mcpRoutes());`. Add `"@justdoit/mcp": "workspace:*"` to `apps/api/package.json` dependencies and run `pnpm install`.

- [ ] **Step 5: Implement — `apps/mcp/src/stdio.ts`**

Build a local ctx and pass it in:

```ts
import { createDb, runMigrations, LOCAL_USER_ID } from '@justdoit/core';
import { createMcpServer } from './server.js';
// …
const { db } = createDb(dbPath);
runMigrations(db);
const server = createMcpServer({ db, userId: LOCAL_USER_ID });
// …connect over stdio transport as before…
```

- [ ] **Step 6: Run to verify pass**

Run: `pnpm --filter @justdoit/api test -- mcp.test`
Expected: PASS — 401 without a key (hosted), a session id with a valid key, and local-user in local mode.

- [ ] **Step 7: Full API + MCP gate + commit**

Run: `pnpm --filter @justdoit/api test && pnpm --filter @justdoit/api typecheck && pnpm --filter @justdoit/mcp test && pnpm --filter @justdoit/mcp typecheck`
Expected: PASS (existing api routes + mcp stdio tool/resource tests still green — they run local-user).

```bash
git add -A
git commit -m "feat(api): key-gated /mcp streamable-HTTP route bound to per-user ctx; mcp stays local-stdio"
```

---

## Task 10: Hosted-mode end-to-end smoke + monorepo gate

**Files:**

- Create: `apps/api/src/hosted-smoke.test.ts`

**Interfaces:**

- Consumes: everything above.
- Produces: a single API-level test file proving the identity wiring end-to-end — the same proxy semantics the web app uses (internal key + `X-User-Id`) plus a per-user key both resolve to the right tenant, cross-tenant access via a foreign key is impossible, **and the `/events` SSE stream never leaks another user's events**.

- [ ] **Step 1: Write the test — `apps/api/src/hosted-smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { createDb, runMigrations, userService, apiKeyService } from '@justdoit/core';
import { createApp } from './app';

const SECRET = 'internal-secret';

describe('hosted-mode identity smoke', () => {
  it('proxy identity and per-user keys resolve to the right tenant', async () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const app = createApp(db, { mode: 'hosted', internalSecret: SECRET });

    const a = userService.upsertByGithubId(db, { githubId: 'A', email: 'a@x.dev', name: 'A', avatarUrl: null });
    const b = userService.upsertByGithubId(db, { githubId: 'B', email: 'b@x.dev', name: 'B', avatarUrl: null });
    const keyA = apiKeyService.create(db, a.id, 'cli').token;

    const proxy = (uid: string, path: string, init: RequestInit = {}) =>
      app.request(path, {
        ...init,
        headers: { 'X-Internal-Key': SECRET, 'X-User-Id': uid, ...(init.headers ?? {}) },
      });

    // A creates a project via the proxy identity.
    const created = await proxy(a.id, '/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A-only' }),
    });
    expect(created.status).toBe(201);
    const project = (await created.json()) as { id: string };

    // B (via proxy) cannot see A's project.
    const bList = (await (await proxy(b.id, '/projects')).json()) as unknown[];
    expect(bList).toHaveLength(0);

    // B cannot fetch A's project by id → NotFound.
    expect((await proxy(b.id, `/projects/${project.id}`)).status).toBe(404);

    // A's API key resolves to A and sees A's project.
    const viaKey = (await app.request('/projects', { headers: { 'X-API-Key': keyA } }).then((r) => r.json())) as unknown[];
    expect(viaKey).toHaveLength(1);

    // No identity at all in hosted mode → 401.
    expect((await app.request('/projects')).status).toBe(401);
  });

  it('the /events SSE stream is filtered to the acting user (no cross-tenant leak)', async () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const app = createApp(db, { mode: 'hosted', internalSecret: SECRET });
    const a = userService.upsertByGithubId(db, { githubId: 'A', email: 'a@x.dev', name: 'A', avatarUrl: null });
    const b = userService.upsertByGithubId(db, { githubId: 'B', email: 'b@x.dev', name: 'B', avatarUrl: null });

    // Open A's event stream via the proxy identity.
    const stream = await app.request('/events', {
      headers: { 'X-Internal-Key': SECRET, 'X-User-Id': a.id, accept: 'text/event-stream' },
    });
    const reader = stream.body!.getReader();

    // B then A each create a task → one domain event per user.
    const mk = (uid: string, title: string) =>
      app.request('/tasks', {
        method: 'POST',
        headers: { 'X-Internal-Key': SECRET, 'X-User-Id': uid, 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
    await mk(b.id, 'B secret task');
    await mk(a.id, 'A own task');

    // A's stream carries only A's event — B's is never delivered (spec §2, the /events filter from 7a Task 15).
    const chunk = new TextDecoder().decode((await reader.read()).value);
    expect(chunk).toContain('A own task');
    expect(chunk).not.toContain('B secret task');
    await reader.cancel();
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @justdoit/api test -- hosted-smoke`
Expected: PASS — the five identity assertions plus the SSE per-user isolation assertion all green.

- [ ] **Step 3: Full monorepo gate**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS across `core`, `api`, `mcp`, `web`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(api): hosted-mode identity + cross-tenant smoke"
```

---

## Phase 7b Definition of Done

- **API** resolves `userId` for every request via the exact 4-step order (internal key + `X-User-Id` → `X-API-Key` → local-user → 401); all four paths + the 401 have tests (`middleware/auth.test.ts`, `hosted-smoke.test.ts`).
- **API** exposes `/api-keys` CRUD scoped to `ctx.userId` (raw shown once, never re-listed) and a `X-Internal-Key`-gated `/internal/users` upsert reachable before identity exists.
- **Web** gates every page behind GitHub OAuth in hosted mode, enforces `AUTH_ALLOWLIST` at `signIn` (rejection → clear screen), upserts the user via the internal API, and carries `userId` in the session; **local dev stays zero-login** (middleware/proxy/API all fall back to `local-user`).
- **Web** proxies browser calls through same-origin `/api/backend/[...path]`, injecting `X-User-Id` + `X-Internal-Key` server-side (cookie stripped), passing JSON, multipart uploads, and SSE (`/events`); the browser never holds a secret. The API client's base is `/api/backend` in hosted mode and the direct API in local.
- **API** `/events` SSE stream is filtered to the acting `c.var.ctx.userId` (per-user isolation implemented in 7a Task 15; a hosted two-user test in `hosted-smoke.test.ts` asserts A's stream excludes B's events).
- **Web** ships a `/settings` screen to create (name), display-once, list, and revoke per-user keys.
- **API** serves a **key-gated `/mcp`** streamable-HTTP route (behind `resolveUser`): hosted with no key → 401, a valid `X-API-Key` mints a session bound to that user via `createMcpServer(ctx)`; local → local-user. There is **no separate hosted `mcp` service** — `apps/mcp` runs stdio as local-user.
- `pnpm test && pnpm typecheck && pnpm lint` pass across the workspace.

## Notes for 7c

- **Env to set on Railway** (`api`): `JUSTDOIT_MODE=hosted`, `INTERNAL_API_SECRET`, plus existing `JUSTDOIT_DB=/data/justdoit.db`, `JUSTDOIT_FILES_DIR=/data/files`. `api` **has a public domain** (for external `/mcp`) but every route requires auth (no anonymous access); the web proxy reaches it over internal DNS.
- **Env** (`web`): `JUSTDOIT_MODE=hosted`, `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_ALLOWLIST`, `INTERNAL_API_URL` (the api's internal hostname), `INTERNAL_API_SECRET` (must equal the api's), and `NEXT_PUBLIC_API_URL=/api/backend`. Do **not** set `NEXT_PUBLIC_API_KEY` in hosted.
- **Hosted MCP:** there is **no separate `mcp` service**. The key-gated `/mcp` route is served by `apps/api` (same volume, same auth ladder); external agents point their MCP client at `https://<api-public-domain>/mcp` with a per-user `X-API-Key`. `apps/mcp` ships only as a local-stdio entrypoint. The old static `JUSTDOIT_API_KEY` gate is gone.
- The proxy uses `runtime = 'nodejs'` and streams `req.body` with `duplex: 'half'`; confirm the Next.js **standalone** build (7c) keeps that route on the Node runtime, and verify SSE isn't buffered by any platform proxy in front of `web`.
- The GitHub OAuth app's callback URL must be `https://<web-domain>/api/auth/callback/github` — a 7c deploy-runbook step.
- `AUTH_SECRET` must be generated (`npx auth secret`) and kept stable across deploys or all sessions invalidate.
- Consider adding a sign-out control + current-user display to `AppShell` in 7c (cosmetic; not required for the invariant).
