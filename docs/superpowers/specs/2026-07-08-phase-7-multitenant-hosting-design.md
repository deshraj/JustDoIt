# Phase 7 — Multitenant Hosting on Railway (Design Spec)

**Status:** Approved for planning
**Date:** 2026-07-08
**Owner:** deshraj

## 1. Summary

Turn JustDoIt into a **multitenant hosted service on Railway, behind GitHub auth**, without
losing the zero-login local-first experience. Every row gains an owner; every query is scoped
to the acting user; users sign in with GitHub (allowlist-gated) and get a fully isolated
workspace. Agents reach a user's data through a per-user API key.

**Decisions (locked):**

- **Host:** Railway (long-running containers + persistent volume — the app runs largely as-is).
- **Auth:** App-level (Auth.js) with **GitHub OAuth**. **Allowlist-only** signup.
- **Tenancy:** Multitenant — per-user data isolation. Local mode pins one implicit user.
- **Hosted DB:** SQLite on a **Railway persistent volume** (same `better-sqlite3` engine).
- **API exposure:** in hosted mode the `api` service is **publicly reachable, but every route
  requires auth** — an internal key + `X-User-Id` (the web proxy over internal DNS), or a
  per-user `X-API-Key` (external agents); no anonymous access. `api` owns the single volume and
  serves **both** the REST API and a key-gated **`/mcp`** endpoint. There is **no separate `mcp`
  service**; the standalone `apps/mcp` package remains only for local stdio use.

## 2. Non-negotiable invariant

> A request acting as user A can never read, mutate, or discover the existence of any row
> owned by user B. Cross-tenant access returns `NotFound` (404), never another user's data.

This is enforced in `packages/core` (not just adapters) and proven by a dedicated
cross-tenant isolation test suite.

## 3. Architecture

```
                 (public, GitHub-gated)          (public, but every route auth-gated)
   Browser ─────▶  web  (Next.js + Auth.js) ────▶  api  (Hono, owns the DB) ──▶ volume:/data
                     │  session → X-User-Id +      │  REST + key-gated /mcp        justdoit.db
                     │  X-Internal-Key             │  (web proxy hop is over        /data/files
                     └──── internal DNS ───────────┘   INTERNAL_API_URL)
                                                     ▲
   AI agent ─────▶  https://<api-public-domain>/mcp ┘  (per-user X-API-Key)
```

- **web** — the only public human surface. Auth.js (GitHub) gates every page via middleware.
  A same-origin proxy route forwards browser calls to `api` over Railway **internal DNS**
  (`INTERNAL_API_URL`, e.g. `http://api.railway.internal:8787`), injecting the user's identity
  server-side. The browser never holds a secret.
- **api** — the same Hono app + `core`, owning the SQLite file on the mounted volume. Serves
  **both** the REST API and a key-gated **`/mcp`** streamable-HTTP endpoint. Publicly reachable
  but **every route requires auth** (internal key from the web proxy, or a per-user `X-API-Key`);
  no anonymous access. May have both an internal address (for the web proxy) and a public domain
  (for external MCP/agents). Runs the reminder scheduler in-process (as today).
- **No separate `mcp` service.** External agents point their MCP client at
  `https://<api-public-domain>/mcp` with their per-user API key. The standalone `apps/mcp`
  package remains only for **local stdio** use (imports `core`, acts as `local-user` or a
  configured key).

## 4. Data model changes

Add two tables and an owner column to every user-owned table.

### New: `users`

- `id` (uuid pk), `github_id` (unique), `email`, `name`, `avatar_url`, `created_at`, `updated_at`.

### New: `api_keys`

- `id` (uuid pk), `user_id` → users, `name`, `token_hash` (sha-256; raw shown once on creation),
  `last_used_at`, `created_at`. Supports multiple keys per user, revocable.

### Owner column

Add `user_id` (text, not null, FK → `users.id`, `onDelete: cascade`) + an index on `user_id`
to: `projects`, `tasks`, `tags`, `time_entries`, `reminders`, `activity_log`, `attachments`,
`saved_filters`. `tags.name` uniqueness becomes **per-user** (`unique(user_id, name)`), not global.

### Migration & backfill

A migration creates the tables/columns, seeds a fixed **local user**
(`id = 'local-user'`), and backfills `user_id = 'local-user'` on all existing rows so current
local databases keep working with no data loss.

## 5. Tenant scoping in `core`

**Pattern:** every service method takes a **context** instead of a bare `db`:

```ts
interface Ctx {
  db: Db;
  userId: string;
}
// before: taskService.list(db, filters)
// after:  taskService.list(ctx, filters)
```

- Every **read** adds `where eq(table.userId, ctx.userId)` (composed with existing filters).
- Every **insert** stamps `userId: ctx.userId`.
- Every **by-id** read/update/delete filters on `userId` too, so a foreign id yields `NotFound`.
- Cross-entity references (e.g. `projectId`, `parentTaskId`, `tagId`) are validated to belong to
  `ctx.userId` before use.

This touches `core` services, their Zod-validated inputs, and the REST/MCP adapters + tests.
A `userScope` helper centralizes the `eq(table.userId, …)` predicate to avoid drift.

**Isolation test suite (required):** for each entity, seed data for user A and user B, then assert
that acting as A: lists exclude B's rows; get/update/delete of B's ids → `NotFound`; and A cannot
attach B's tag / reparent under B's task / file time against B's task.

## 6. Identity & auth flow

### Modes

- **Local mode** (default when GitHub env is absent, or `JUSTDOIT_MODE=local`): no auth. All
  requests act as the fixed `local-user`. Current behavior, unchanged.
- **Hosted mode** (`JUSTDOIT_MODE=hosted`): auth required; real users.

### Web (Auth.js + GitHub)

- GitHub OAuth provider. On sign-in, the `signIn` callback checks the email/login against
  `AUTH_ALLOWLIST` (comma-separated); non-allowlisted users are rejected with a clear screen.
- On success, upsert a `users` row and put `userId` in the session/JWT.
- Middleware protects all app routes and the proxy; unauthenticated → sign-in.

### Web → API proxy

- A catch-all route (`/api/backend/[...path]`) forwards browser requests to the **internal** API
  base (`INTERNAL_API_URL`), after verifying the session, adding headers
  `X-User-Id: <session.userId>` and `X-Internal-Key: <INTERNAL_API_SECRET>`.
- The browser calls only same-origin `/api/backend/*`; the client's `NEXT_PUBLIC_API_URL`
  points at this proxy in hosted mode.

### API auth middleware (resolves `userId`)

Order of resolution:

1. Valid `X-Internal-Key` (matches `INTERNAL_API_SECRET`) → trust `X-User-Id`. _(web proxy)_
2. Else valid `X-API-Key` → `apiKeyService.resolveToken` (`api_keys.token_hash`) → `userId`. _(agents/MCP/scripts)_
3. Else, in local mode (`JUSTDOIT_MODE=local`) → `local-user`.
4. Else (hosted, no identity) → **401**. No anonymous access in hosted mode.

Every route builds `ctx = { db, userId }` from this and passes it to `core`.

### Per-user API keys

- A settings surface (web) to create/name/revoke keys; the raw key is shown once, stored hashed.
- The key-gated `/mcp` endpoint (served by `api`) and the public REST API resolve the key to a
  `userId`, so an agent only ever sees its owner's data.

## 7. Deployment (Railway)

One Railway project, **two** services from this monorepo:

| Service | Build                                   | Public?                                      | Notes                                                                                         |
| ------- | --------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `web`   | Dockerfile (Next.js standalone)         | ✅ custom domain                             | Auth.js, proxy → `api` over internal DNS.                                                     |
| `api`   | Dockerfile (tsx/node, `better-sqlite3`) | ✅ public domain, **every route auth-gated** | Mounts volume at `/data`; serves REST **+ key-gated `/mcp`**; runs scheduler; single replica. |

- **Volume** mounted at `/data` on `api` → `JUSTDOIT_DB=/data/justdoit.db`,
  `JUSTDOIT_FILES_DIR=/data/files`. Single `api` replica (SQLite file ownership).
- **Networking:** `web` reaches `api` over Railway **internal DNS** (`INTERNAL_API_URL`, e.g.
  `http://api.railway.internal:8787`) with `X-Internal-Key` + `X-User-Id`. `api` also has a
  **public domain** for external MCP/agents (`https://<api-domain>/mcp`, per-user `X-API-Key`);
  every route still requires auth. **No standalone `mcp` service** — `apps/mcp` is local stdio only.
- **Env (hosted):** `JUSTDOIT_MODE=hosted`, `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`,
  `AUTH_ALLOWLIST`, `INTERNAL_API_URL`, `INTERNAL_API_SECRET`, `NEXT_PUBLIC_API_URL=/api/backend`,
  plus the existing `JUSTDOIT_*` (`JUSTDOIT_DB`, `JUSTDOIT_FILES_DIR`, `JUSTDOIT_API_PORT`,
  `JUSTDOIT_API_HOST`).
- **Notifications:** desktop notifications don't exist in a container; hosted reminders surface as
  in-app "due/overdue" indicators (already present) — the scheduler still marks reminders delivered.
- Project creation, secrets, and `railway up` run from the owner's terminal; the repo ships
  Dockerfiles + a `railway.json`/service config + a deploy runbook.

## 8. Sub-phases (each its own plan)

- **7a — Multitenancy in `core`:** users/api_keys tables + `user_id` columns + migration/backfill;
  `Ctx` threading through all services; per-user tag uniqueness; **cross-tenant isolation tests**;
  REST + MCP updated to build and pass `ctx` (local mode = `local-user`). App still runs locally.
- **7b — GitHub auth & keys:** Auth.js + GitHub + allowlist in `web`; session→`userId`; the
  `/api/backend` proxy with `X-User-Id`/`X-Internal-Key`; API auth middleware resolving all three
  paths; per-user API-key create/revoke UI + hashing; a key-gated **`/mcp`** streamable-HTTP route
  served by `apps/api` (`apps/mcp` stays local stdio).
- **7c — Railway packaging:** Dockerfiles for `web`/`api`; `railway.json` + volume + internal DNS
  - env; `api` public with a key-gated `/mcp`; Next.js standalone build; deploy runbook; smoke
    checklist. `apps/mcp` ships no hosted service (local stdio only).

## 9. Security considerations

- `api` is publicly reachable in hosted mode but **every route requires auth** (internal key or
  per-user API key); no anonymous access. `X-Internal-Key` is defense-in-depth for the trusted
  web-proxy path (the web hop uses internal DNS, so the key never leaves server-side).
- API keys stored only as SHA-256 hashes; shown once.
- Allowlist enforced at sign-in; rejected users create no data.
- CORS restricted to the web origin; the proxy is same-origin so credentials stay first-party.
- Isolation invariant (§2) is the primary control; isolation tests are the gate.

## 10. Out of scope (future)

Team/org shared workspaces, task sharing between users, billing/plans, auth providers beyond
GitHub, horizontal scaling of the DB (would move SQLite→libSQL/Turso or Postgres), and email/
web-push notification channels.
