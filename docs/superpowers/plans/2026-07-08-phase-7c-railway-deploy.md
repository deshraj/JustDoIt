# Phase 7c: Railway Packaging & Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **deployment/packaging** sub-phase: tasks produce config, Dockerfiles, and a runbook — not TDD unit tests. Every task still ends with a concrete, runnable verification (an image that builds, a container that boots and passes a health check, a `next build` that emits a standalone bundle, etc.).

**Goal:** Package `web`, `api`, and `mcp` as production container images and ship the Railway config, environment matrix, and deploy runbook so the owner can stand up a multitenant JustDoIt on Railway from their terminal — while local `pnpm dev` (zero-login, file-SQLite) stays byte-for-byte unaffected.

**Architecture (target, from spec §3 and §7):**

```
                 (public, GitHub-gated)              (public, but every route auth-gated)
   Browser ─────▶  web  (Next standalone) ──────────▶  api  (Hono via tsx) ──▶ volume:/data
                     │  session → X-User-Id +          │  REST + key-gated /mcp   justdoit.db
                     │  X-Internal-Key                 │  (web hop over            /data/files
                     └──────── INTERNAL_API_URL ───────┘   internal DNS)
                                                         ▲
   AI agent ─────▶  https://<api-public-domain>/mcp ────┘  (per-user X-API-Key)
```

- **api** — owns the SQLite file on the single Railway **volume** mounted at `/data`. Serves **both** the REST API and a key-gated **`/mcp`** route. Runs `runMigrations` on boot (already wired in `apps/api/src/index.ts`) and the reminder scheduler in-process. Publicly reachable **but every route requires auth** (internal key from the web proxy, or a per-user `X-API-Key`); no anonymous access. The web app reaches it over Railway internal DNS (`api.railway.internal:8787`); external agents reach `/mcp` at its public domain.
- **web** — the only public human surface (custom domain). Next.js `output: 'standalone'` image. Talks to `api` server-side over the internal network via `INTERNAL_API_URL`.
- **No separate `mcp` service.** The hosted MCP surface is `https://<api-public-domain>/mcp`, served by `api` (Phase 7b). The standalone `apps/mcp` package is **local-stdio only** and is **not** deployed to Railway.

**Chosen runtime approach: `tsx` (run TypeScript directly in the container) — NOT a bundler (`tsup`/esbuild).**
Justification: `@justdoit/core` is consumed from TS source (`main`/`exports` → `./src/index.ts`), and `apps/api` already ships a `start` script that runs under `tsx` (`apps/mcp` likewise, though it is local-stdio only and not deployed). Bundling would force us to (a) externalize the `better-sqlite3` native addon anyway, (b) re-resolve Drizzle's on-disk `drizzle/` migrations folder (`runMigrations` derives it from `import.meta.url`), and (c) reproduce pnpm workspace resolution — all friction for zero payoff on a single-owner, low-traffic tool. We keep the existing scripts, ship `node_modules` + source, and run `tsx`. `web` still uses the Next.js compiler (`output: 'standalone'`) for a small image.

**Tech Stack:** Docker multi-stage builds (BuildKit), `node:22-bookworm-slim` base (glibc — matches `better-sqlite3` prebuilds; **not** Alpine/musl), pnpm 10.4.1 via Corepack, Next.js 15 standalone output, Railway (Dockerfile builder + persistent volume + private networking), `railway` CLI.

## Global Constraints

- **Base image is glibc, not musl.** Use `node:22-bookworm-slim`. `better-sqlite3` ships glibc prebuilds; Alpine (musl) would force a from-source compile and risk ABI drift. The build stage still installs `python3 make g++` so a from-source fallback works. Verbatim.
- **`tsx` runs in production.** Images install full deps (including `devDependencies` — `tsx`, `typescript`), so **do not** pass `--prod` to `pnpm install`. Verbatim.
- **One writer for the SQLite file.** Only **one** service (`api`) mounts the volume and opens `justdoit.db`. `numReplicas: 1` on `api`. Verbatim.
- **Single volume-owning service, no separate `mcp` (D1).** The Railway volume attaches to exactly one service — `api` — which also serves the key-gated `/mcp` route in-process (Phase 7b), so it opens the DB file directly. There is **no separate `mcp` service** to reach the volume over the network, and therefore **no private-networking workaround**. External agents hit `https://<api-public-domain>/mcp` with a per-user `X-API-Key`. The standalone `apps/mcp` package is local-stdio only and is **not** containerized for Railway. The go-live path is `web` + `api`.
- **Bind to `0.0.0.0` in containers, loopback locally.** `apps/api/src/index.ts` already reads `JUSTDOIT_API_HOST` (defaults to `127.0.0.1`); the image sets `JUSTDOIT_API_HOST=0.0.0.0`. Local dev is untouched. Verbatim.
- **Build context is the repo root** for every service (pnpm workspace needs the root `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and every workspace `package.json`). `dockerfilePath` in `railway.json` is relative to the repo root. Verbatim.
- **Migrations run on api startup**, unchanged: `index.ts` → `runMigrations(db)` against `JUSTDOIT_DB=/data/justdoit.db`. `runMigrations` resolves `packages/core/drizzle` from `import.meta.url`, so the image must copy `packages/core` in full (including `drizzle/`). Verbatim.
- Docker + the `railway` CLI are already installed on the owner's machine (`/usr/local/bin/docker`, `/opt/homebrew/bin/railway`). Image builds in this plan are verified locally with `docker build`; Railway performs the same build remotely.

---

## File Structure (new/changed in this sub-phase)

```
justdoit/
├── .dockerignore                # NEW — keep build context small & deterministic
├── docker-compose.yml           # NEW — local hosted-mode simulation (Task 7)
├── .env.example                 # NEW — full env matrix template (Task 6)
├── apps/
│   ├── api/
│   │   ├── Dockerfile           # NEW (Task 2)
│   │   └── railway.json         # NEW (Task 5)
│   ├── web/
│   │   ├── Dockerfile           # NEW (Task 3)
│   │   ├── railway.json         # NEW (Task 5)
│   │   ├── next.config.ts       # CHANGED — add output: 'standalone' (Task 1)
│   │   └── public/.gitkeep      # NEW — ensures the standalone COPY has a source (Task 1)
│   └── mcp/                     # LOCAL-STDIO ONLY — no Dockerfile, no Railway service (D1)
└── docs/
    └── DEPLOY.md                # NEW — owner runbook + smoke checklist (Tasks 8–9)
```

---

## Task 1: Runtime prep — standalone output, `.dockerignore`, base-image decision

**Files:**

- Modify: `apps/web/next.config.ts` (add `output: 'standalone'`)
- Create: `apps/web/public/.gitkeep`
- Create: `.dockerignore`

**Interfaces:**

- Consumes: nothing (first task).
- Produces:
  - A Next.js **standalone** build (`apps/web/.next/standalone/apps/web/server.js` + traced `node_modules`), the artifact the `web` image copies.
  - A repo-root `apps/web/public/` directory so the web Dockerfile's `COPY … public` step always has a source (the app currently ships no `public/`).
  - A `.dockerignore` that excludes local DBs, `node_modules`, build outputs, and caches from every service's build context — keeping builds fast, reproducible, and free of the local `justdoit.db*` files.

- [ ] **Step 1: Add standalone output — modify `apps/web/next.config.ts`**

Add `output: 'standalone'` to the existing config (keep the `outputFileTracingRoot` pin — it makes the standalone bundle root at the monorepo root, which the web Dockerfile relies on):

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (.next/standalone) for a small image.
  output: 'standalone',
  // Root file-tracing at the monorepo root so the standalone bundle mirrors
  // the workspace layout (server.js lands at apps/web/server.js).
  outputFileTracingRoot: path.join(dirname, '../..'),
};

export default nextConfig;
```

- [ ] **Step 2: Create `apps/web/public/.gitkeep`**

The app has no `public/` directory; create one so the image's `COPY … apps/web/public` never fails.

```

```

(Empty file. `apps/web/public/.gitkeep`.)

- [ ] **Step 3: Write `.dockerignore` (repo root)**

```
# deps & build outputs (installed/built inside the image)
**/node_modules
**/.next
**/dist
**/.turbo
**/*.tsbuildinfo

# local databases & data — never bake these into an image
*.db
*.db-shm
*.db-wal
data/
**/data/files

# local env & secrets
.env
.env.local
**/.env
**/.env.local

# vcs / editor / os
.git
.gitignore
.DS_Store

# tests & reports not needed at runtime
**/test-results
**/playwright-report
**/blob-report
**/coverage
docs/
```

- [ ] **Step 4: Verify the standalone build emits `server.js`**

Run:

```bash
pnpm --filter @justdoit/web build
ls apps/web/.next/standalone/apps/web/server.js && ls -d apps/web/.next/standalone/node_modules
```

Expected: `next build` completes; both `ls` lines print a path (no "No such file"). The presence of `apps/web/.next/standalone/apps/web/server.js` confirms standalone output with the monorepo-rooted layout the web image expects.

- [ ] **Step 5: Verify `.dockerignore` excludes the local DB**

Run:

```bash
git check-ignore -v justdoit.db || true
grep -c '\*.db' .dockerignore
```

Expected: the `grep` prints `1` (the `*.db` line exists), confirming the ~160 KB local `justdoit.db-wal` and friends will not enter any build context.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(deploy): standalone web output + .dockerignore for container builds"
```

---

## Task 2: `apps/api/Dockerfile` — auth-gated API image with volume DB + healthcheck

**Files:**

- Create: `apps/api/Dockerfile`

**Interfaces:**

- Consumes: repo-root pnpm workspace manifests + lockfile; `packages/core` (schema + `drizzle/` migrations); `apps/api` source; `apps/mcp` source (`@justdoit/mcp`, for the `/mcp` route's `createMcpServer`); `.dockerignore` from Task 1.
- Produces: an image that
  - **Consumes env:** `JUSTDOIT_DB` (default `/data/justdoit.db`), `JUSTDOIT_FILES_DIR` (default `/data/files`), `JUSTDOIT_API_PORT` (`8787`), `JUSTDOIT_API_HOST` (`0.0.0.0`), plus (7b) `JUSTDOIT_MODE`, `INTERNAL_API_SECRET`.
  - **Produces:** an HTTP service on `:8787` bound to `0.0.0.0`, serving `GET /health → {"status":"ok"}`; internal hostname `api.railway.internal`.
  - Runs `runMigrations` against the volume DB on boot; runs the reminder scheduler in-process; runs as non-root `app`.
  - **EXPOSE 8787**; **HEALTHCHECK** hits `/health`.

- [ ] **Step 1: Write `apps/api/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

########## base: pnpm on glibc node ##########
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
WORKDIR /app

########## deps: workspace install (builds better-sqlite3 native addon) ##########
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# Copy only manifests first so this layer caches across source-only changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/mcp/package.json apps/mcp/package.json
COPY apps/web/package.json apps/web/package.json
# Full install (incl. tsx/devDeps — we run TypeScript in prod). better-sqlite3
# builds here via the root pnpm.onlyBuiltDependencies allowlist.
RUN pnpm install --frozen-lockfile

########## runtime ##########
FROM base AS runtime
ENV NODE_ENV=production
# Installed deps (root virtual store + per-workspace symlinked node_modules).
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/apps/mcp/node_modules ./apps/mcp/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
# Workspace metadata + the source we actually run. `apps/api` imports the shared
# `createMcpServer` from `@justdoit/mcp` (for the /mcp route), so ship apps/mcp too.
COPY package.json pnpm-workspace.yaml ./
COPY packages/core ./packages/core
COPY apps/mcp ./apps/mcp
COPY apps/api ./apps/api
# Non-root user; owned /data mountpoint for the volume.
RUN groupadd -r app && useradd -r -g app -d /app app \
  && mkdir -p /data/files && chown -R app:app /data /app
USER app
ENV JUSTDOIT_API_HOST=0.0.0.0 \
    JUSTDOIT_API_PORT=8787 \
    JUSTDOIT_DB=/data/justdoit.db \
    JUSTDOIT_FILES_DIR=/data/files
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.JUSTDOIT_API_PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@justdoit/api", "start"]
```

- [ ] **Step 2: Build the image**

Run (from repo root — the build context):

```bash
docker build -f apps/api/Dockerfile -t justdoit-api:local .
```

Expected: build succeeds through all stages. The `deps` stage logs a successful `better-sqlite3` build/install with no "ignored build scripts" warning (root `pnpm.onlyBuiltDependencies` covers it). Final line: `naming to docker.io/library/justdoit-api:local`.

- [ ] **Step 3: Boot the container against an ephemeral volume and hit `/health`**

```bash
docker run -d --name jdi-api --rm \
  -e JUSTDOIT_MODE=local \
  -v jdi-data:/data -p 8787:8787 justdoit-api:local
# wait for boot + migrations, then probe
sleep 4
curl -fsS http://127.0.0.1:8787/health
```

Expected: `curl` prints `{"status":"ok"}` (exit 0). `docker logs jdi-api` shows `justdoit API listening on http://0.0.0.0:8787 (db: /data/justdoit.db, files: /data/files)`.

- [ ] **Step 4: Verify migrations wrote the DB onto the volume, then clean up**

```bash
docker exec jdi-api ls -la /data/justdoit.db
docker inspect --format '{{json .State.Health.Status}}' jdi-api
docker rm -f jdi-api && docker volume rm jdi-data
```

Expected: `/data/justdoit.db` exists (non-zero size — proves `runMigrations` ran against the volume). Health status prints `"healthy"` (the HEALTHCHECK passed at least once).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(deploy): api Dockerfile (tsx runtime, volume DB, /health healthcheck)"
```

---

## Task 3: `apps/web/Dockerfile` — Next.js standalone public image

**Files:**

- Create: `apps/web/Dockerfile`

**Interfaces:**

- Consumes: repo workspace + lockfile; `apps/web` source; the standalone build (Task 1); `.dockerignore`.
- Produces: an image that
  - **Consumes env (7b):** `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_ALLOWLIST`, `INTERNAL_API_URL` (→ `http://api.railway.internal:8787`), `INTERNAL_API_SECRET`, `NEXT_PUBLIC_API_URL` (`/api/backend`), `AUTH_URL` (public web origin).
  - **Produces:** an HTTP server on `:3000` bound to `0.0.0.0` (Next standalone `server.js`); gets the public custom domain.
  - Runs as non-root `app`.

- [ ] **Step 1: Write `apps/web/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
WORKDIR /app

########## deps ##########
FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/mcp/package.json apps/mcp/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

########## build (next build → .next/standalone) ##########
FROM base AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY . .
RUN pnpm --filter @justdoit/web build

########## runtime (only the standalone bundle) ##########
FROM base AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN groupadd -r app && useradd -r -g app -d /app app
# Standalone server + its traced node_modules (monorepo-rooted layout).
COPY --from=build --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /app/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
```

- [ ] **Step 2: Build the image**

```bash
docker build -f apps/web/Dockerfile -t justdoit-web:local .
```

Expected: build succeeds; the `build` stage runs `next build` and reports "Creating an optimized production build" then route output; final line names `justdoit-web:local`.

- [ ] **Step 3: Boot and confirm the server responds**

```bash
docker run -d --name jdi-web --rm \
  -e AUTH_SECRET=dev-secret-not-real \
  -e INTERNAL_API_URL=http://127.0.0.1:8787 \
  -e NEXT_PUBLIC_API_URL=/api/backend \
  -p 3000:3000 justdoit-web:local
sleep 3
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
docker logs jdi-web 2>&1 | head -3
docker rm -f jdi-web
```

Expected: `curl` prints an HTTP status (`200`, or `3xx`/`307` if Auth.js middleware redirects unauthenticated traffic to sign-in — any non-`000`, non-`5xx` response proves the standalone server booted). Logs show Next's `▲ Next.js` ready line listening on `0.0.0.0:3000`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(deploy): web Dockerfile (Next.js standalone, non-root)"
```

---

## Task 4: Verify the `api` image serves the key-gated `/mcp` route (no separate mcp image)

Per D1 there is **no hosted `mcp` service** — the MCP surface is served by `apps/api` at `/mcp` (built in Phase 7b) and is reached at the `api` public domain with a per-user `X-API-Key`. This task ships **no `apps/mcp/Dockerfile`**; it verifies the `api` image (Task 2) already exposes a working `/mcp` and records that `apps/mcp` is local-stdio only.

**Files:**

- None created. (Explicitly **do not** create `apps/mcp/Dockerfile` or a Railway `mcp` service.)

**Interfaces:**

- Consumes: the `justdoit-api:local` image from Task 2 (which serves REST **+** `/mcp`).
- Produces: confirmation that external MCP works against `api/mcp`; documentation that `apps/mcp` is local-stdio only.

- [ ] **Step 1: Boot the `api` image and confirm `/mcp` initializes with a key**

Reuse the Task 2 image. In local mode `/mcp` accepts a keyless `initialize` (resolves `local-user`):

```bash
docker run -d --name jdi-api --rm \
  -e JUSTDOIT_MODE=local \
  -v jdi-data:/data -p 8787:8787 justdoit-api:local
sleep 4
curl -fsS -o /dev/null -w "mcp-init:%{http_code}\n" -X POST http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
docker rm -f jdi-api && docker volume rm jdi-data
```

Expected: `mcp-init:200` (local mode resolves `local-user`; the response is an SSE stream carrying the `initialize` result). In hosted mode the same request **without** an `X-API-Key` would return `401` (verified live in Task 9's smoke checklist).

- [ ] **Step 2: Confirm `apps/mcp` has no Dockerfile / Railway service**

```bash
test ! -f apps/mcp/Dockerfile && echo "no hosted mcp image: OK"
test ! -f apps/mcp/railway.json && echo "no mcp railway service: OK"
```

Expected: both `OK` lines. `apps/mcp` remains the local-stdio entrypoint only (run via `pnpm --filter @justdoit/mcp start` locally); it is never deployed.

- [ ] **Step 3: Commit (no-op if nothing changed)**

This task creates no files; if a prior draft added an `apps/mcp/Dockerfile`/`railway.json`, remove them:

```bash
git rm -f apps/mcp/Dockerfile apps/mcp/railway.json 2>/dev/null || true
git commit -m "chore(deploy): no hosted mcp service — /mcp is served by api (apps/mcp is local-stdio only)" --allow-empty
```

---

## Task 5: Railway service configs (`railway.json` × 2) + volume/networking documentation

**Files:**

- Create: `apps/api/railway.json`
- Create: `apps/web/railway.json`

**Interfaces:**

- Consumes: the two Dockerfiles (Tasks 2–3).
- Produces: per-service Railway build/deploy config the owner points each Railway service at (via the service's **Config-as-code path** setting). Declares the Dockerfile builder, healthcheck, restart policy, and (for `api`) `numReplicas: 1`. **Volumes, public domains, and internal networking are NOT expressible in `railway.json`** — they are set via the CLI/dashboard and are documented here + in the runbook (Task 8). Internal hostnames Railway assigns: `api.railway.internal`, `web.railway.internal`. There is **no `mcp` service** (D1).

- [ ] **Step 1: Write `apps/api/railway.json`**

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "apps/api/Dockerfile"
  },
  "deploy": {
    "startCommand": "pnpm --filter @justdoit/api start",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 60,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5,
    "numReplicas": 1
  }
}
```

- [ ] **Step 2: Write `apps/web/railway.json`**

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "apps/web/Dockerfile"
  },
  "deploy": {
    "startCommand": "node apps/web/server.js",
    "healthcheckPath": "/",
    "healthcheckTimeout": 60,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 5
  }
}
```

- [ ] **Step 3: Validate the JSON and record the non-`railway.json` settings**

Run:

```bash
for f in apps/api/railway.json apps/web/railway.json; do
  node -e "JSON.parse(require('node:fs').readFileSync('$f','utf8')); console.log('OK $f')"
done
```

Expected: two `OK …` lines (valid JSON).

Record (for the runbook) the settings that live **outside** `railway.json`, applied per service in the dashboard/CLI:

| Service | Root/config path        | Public domain                                          | Volume                     | Networking role                                                                           |
| ------- | ----------------------- | ------------------------------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------- |
| `api`   | `apps/api/railway.json` | **Yes** — every route auth-gated; serves REST + `/mcp` | **Yes** — mount at `/data` | internal target `api.railway.internal:8787` (web proxy) + public domain (external `/mcp`) |
| `web`   | `apps/web/railway.json` | **Yes** (custom domain)                                | No                         | client → `api` over internal DNS                                                          |

There is **no `mcp` service** — the MCP surface is `api`'s `/mcp` route (D1).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(deploy): per-service railway.json (api + web; Dockerfile builder + healthchecks)"
```

---

## Task 6: Environment matrix + `.env.example`

**Files:**

- Create: `.env.example`

**Interfaces:**

- Consumes: env contracts from all prior tasks + 7b (`JUSTDOIT_MODE`, `AUTH_*`, `INTERNAL_API_*`).
- Produces: a single documented template of every variable, its owner service, and its local vs hosted value. `.env.example` is committed (real `.env`/`.env.local` stay git-ignored). Secrets are **not** stored in the repo — they are set in Railway (Task 8).

- [ ] **Step 1: Write `.env.example` (repo root)**

```bash
# ─────────────────────────────────────────────────────────────────────────────
# JustDoIt environment template. Copy to .env.local for local hosted-mode tests.
# In production these are set as Railway service variables (NEVER committed).
# ─────────────────────────────────────────────────────────────────────────────

# ── Mode (all services) ──────────────────────────────────────────────────────
# local  → no auth, everything acts as the fixed `local-user` (default).
# hosted → GitHub auth required; real per-user tenancy.
JUSTDOIT_MODE=hosted

# ── api service ──────────────────────────────────────────────────────────────
# Local default: ./justdoit.db + ./data/files, bound to 127.0.0.1.
# Hosted: on the Railway volume, bound to 0.0.0.0 (image sets these defaults).
JUSTDOIT_DB=/data/justdoit.db
JUSTDOIT_FILES_DIR=/data/files
JUSTDOIT_API_PORT=8787
JUSTDOIT_API_HOST=0.0.0.0
# Shared secret the web proxy sends as X-Internal-Key; api trusts X-User-Id when
# it matches. Generate: `openssl rand -hex 32`.
INTERNAL_API_SECRET=replace-with-openssl-rand-hex-32

# ── web service ──────────────────────────────────────────────────────────────
# Auth.js session encryption. Generate: `openssl rand -base64 32`.
AUTH_SECRET=replace-with-openssl-rand-base64-32
# GitHub OAuth app credentials (Settings → Developer settings → OAuth Apps).
AUTH_GITHUB_ID=replace-with-github-oauth-client-id
AUTH_GITHUB_SECRET=replace-with-github-oauth-client-secret
# Comma-separated allowlist of GitHub logins/emails permitted to sign in.
AUTH_ALLOWLIST=deshraj
# Public URL of the web app (used by Auth.js for callback/base URL).
AUTH_URL=https://justdoit.example.com
# Private base URL of the api over Railway's internal network.
INTERNAL_API_URL=http://api.railway.internal:8787
# Same shared secret as the api's INTERNAL_API_SECRET.
INTERNAL_API_SECRET=replace-with-openssl-rand-hex-32
# Browser-facing API base = the same-origin proxy route (never the real api URL).
NEXT_PUBLIC_API_URL=/api/backend

# ── MCP ──────────────────────────────────────────────────────────────────────
# No hosted mcp service (D1): the MCP surface is api's key-gated /mcp route,
# reached at the api public domain with a per-user X-API-Key. `apps/mcp` is
# local-stdio only (run `pnpm --filter @justdoit/mcp start` locally); no env here.
# Local http entrypoint, if used, still reads JUSTDOIT_MCP_PORT.
JUSTDOIT_MCP_PORT=3939
```

Full per-service matrix (local vs hosted):

| Variable              | Service(s)       | Local value                    | Hosted (Railway) value             | Secret? |
| --------------------- | ---------------- | ------------------------------ | ---------------------------------- | ------- |
| `JUSTDOIT_MODE`       | all              | `local` (or unset)             | `hosted`                           | no      |
| `JUSTDOIT_DB`         | api              | `./justdoit.db` (default)      | `/data/justdoit.db`                | no      |
| `JUSTDOIT_FILES_DIR`  | api              | `./data/files` (default)       | `/data/files`                      | no      |
| `JUSTDOIT_API_PORT`   | api              | `8787`                         | `8787`                             | no      |
| `JUSTDOIT_API_HOST`   | api              | `127.0.0.1` (default)          | `0.0.0.0` (image default)          | no      |
| `INTERNAL_API_SECRET` | api, web, mcp    | any dev string                 | `openssl rand -hex 32`             | **yes** |
| `INTERNAL_API_URL`    | web, mcp         | `http://127.0.0.1:8787`        | `http://api.railway.internal:8787` | no      |
| `NEXT_PUBLIC_API_URL` | web              | `/api/backend`                 | `/api/backend`                     | no      |
| `AUTH_SECRET`         | web              | dev string                     | `openssl rand -base64 32`          | **yes** |
| `AUTH_GITHUB_ID`      | web              | OAuth app (localhost callback) | OAuth app (prod callback)          | **yes** |
| `AUTH_GITHUB_SECRET`  | web              | OAuth app secret               | OAuth app secret                   | **yes** |
| `AUTH_ALLOWLIST`      | web              | your GitHub login              | comma-list of logins               | no      |
| `AUTH_URL`            | web              | `http://localhost:3000`        | `https://<custom-domain>`          | no      |
| `JUSTDOIT_MCP_PORT`   | mcp (local only) | `3939`                         | — (no hosted mcp service)          | no      |

- [ ] **Step 2: Verify `.env.example` is committed but real env files stay ignored**

Run:

```bash
git check-ignore .env .env.local && echo "real env files ignored: OK"
git add .env.example && git status --porcelain .env.example
```

Expected: prints `real env files ignored: OK`, and `.env.example` shows as staged (`A  .env.example`) — the template is tracked, secrets are not.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs(deploy): env matrix + .env.example template"
```

---

## Task 7: Local hosted-mode parity — `docker-compose.yml` end-to-end simulation

**Files:**

- Create: `docker-compose.yml`

**Interfaces:**

- Consumes: the two images (Tasks 2–3) and env contracts (Task 6).
- Produces: a one-command local stack that exercises the **hosted** path (web → api over `INTERNAL_API_URL`, with `X-Internal-Key`) end-to-end before touching Railway — proving the proxy/auth wiring works in containers. Confirms local `pnpm dev` (file-SQLite, no auth) is a separate, unaffected path.

- [ ] **Step 1: Write `docker-compose.yml` (repo root)**

```yaml
# Local hosted-mode simulation. Mirrors the Railway topology:
#   web (public) → api (volume owner; also serves the key-gated /mcp route).
# There is no separate mcp service (D1). Usage: docker compose up --build (Ctrl-C to stop).
# This is a test harness, NOT the production deploy — Railway builds the same
# Dockerfiles and injects the same env; on Railway the web→api hop uses internal DNS.
services:
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    environment:
      JUSTDOIT_MODE: hosted
      JUSTDOIT_DB: /data/justdoit.db
      JUSTDOIT_FILES_DIR: /data/files
      JUSTDOIT_API_HOST: 0.0.0.0
      INTERNAL_API_SECRET: local-internal-secret
    volumes:
      - jdi-data:/data
    # No published ports here: this sim exercises the web→api internal hop only.
    # (On Railway `api` also gets a public domain for external /mcp; every route
    #  still requires auth.)

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    depends_on:
      - api
    environment:
      JUSTDOIT_MODE: hosted
      AUTH_SECRET: local-auth-secret-not-real
      AUTH_GITHUB_ID: ${AUTH_GITHUB_ID}
      AUTH_GITHUB_SECRET: ${AUTH_GITHUB_SECRET}
      AUTH_ALLOWLIST: ${AUTH_ALLOWLIST}
      AUTH_URL: http://localhost:3000
      INTERNAL_API_URL: http://api:8787
      INTERNAL_API_SECRET: local-internal-secret
      NEXT_PUBLIC_API_URL: /api/backend
    ports:
      - '3000:3000'
    # External MCP is served by api at /mcp (reached via the web proxy or the api
    # public domain on Railway) — there is no separate mcp service.

volumes:
  jdi-data:
```

- [ ] **Step 2: Build and start the core stack**

```bash
docker compose up --build -d api web
docker compose ps
```

Expected: `docker compose ps` shows `api` and `web` as `running` (api may show `healthy`). No image build errors.

- [ ] **Step 3: Confirm web serves and reaches api over the internal network through the proxy**

```bash
# Public web responds:
curl -fsS -o /dev/null -w "web:%{http_code}\n" http://127.0.0.1:3000/
# api is NOT published to the host (private-by-topology):
curl -fsS -o /dev/null -w "api-direct:%{http_code}\n" http://127.0.0.1:8787/health || echo "api not reachable from host (expected)"
# api IS reachable from inside the web container over the compose network:
docker compose exec web node -e "fetch('http://api:8787/health').then(r=>r.text()).then(t=>console.log('api-from-web:'+t))"
```

Expected: `web:200`/`web:307` (web up); `api not reachable from host (expected)` (this sim doesn't host-publish `api` — the web proxy reaches it internally); `api-from-web:{"status":"ok"}` (proves web→api internal reachability, the hosted path). A full sign-in requires real GitHub OAuth creds in `.env.local`; without them the allowlist/auth path is validated later in Task 9's Railway smoke run.

- [ ] **Step 4: Tear down**

```bash
docker compose down -v
```

Expected: containers stop; the `jdi-data` volume is removed (`-v`).

- [ ] **Step 5: Confirm local `pnpm dev` parity is untouched**

```bash
git stash list && echo "no runtime code changed for local dev"
grep -n '"dev"' apps/api/package.json apps/mcp/package.json apps/web/package.json
```

Expected: the `dev` scripts still read `tsx watch …` / `next dev` (this sub-phase added only Dockerfiles, config, and the one `next.config.ts` line). Local `pnpm dev` continues to default `JUSTDOIT_MODE` to local (no auth, `./justdoit.db`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(deploy): docker-compose local hosted-mode simulation"
```

---

## Task 8: Deploy runbook — `docs/DEPLOY.md`

**Files:**

- Create: `docs/DEPLOY.md`

**Interfaces:**

- Consumes: all Dockerfiles, `railway.json` files, and the env matrix.
- Produces: the step-by-step commands the **owner** runs from their terminal. The repo ships artifacts only; project creation, secrets, volume, and `railway up` are human actions. Includes GitHub OAuth callback setup and custom-domain wiring.

- [ ] **Step 1: Write `docs/DEPLOY.md`**

````markdown
# Deploying JustDoIt to Railway

The repo ships the build artifacts (Dockerfiles, `railway.json`, env template).
**You** (the owner) create the Railway project, set secrets, attach the volume,
and run the deploys from your terminal. Nothing here is automated in CI.

Prerequisites: `railway` CLI logged in, Docker (for local pre-flight), a GitHub
account, and a domain you control (optional but recommended).

## 0. Pre-flight (local)

Build both images once to catch errors before Railway does:

```bash
docker build -f apps/api/Dockerfile -t jdi-api .
docker build -f apps/web/Dockerfile -t jdi-web .
```

Both must succeed. (There is no `mcp` image — the MCP surface is `api`'s `/mcp` route.)

## 1. Create the project and services

```bash
railway login
railway init            # name it "justdoit"; creates the project
# Create the two services (empty shells; we point each at its Dockerfile next):
railway add --service api
railway add --service web
# No mcp service — the MCP surface is api's /mcp route (D1).
```

For each service, set its **config-as-code path** so Railway uses the right
Dockerfile/build/deploy settings (Settings → Config-as-code, or CLI):

- `api` → `apps/api/railway.json`
- `web` → `apps/web/railway.json`

Leave the build **root directory** at the repo root (the Dockerfiles need the
full workspace).

## 2. Attach the volume to `api`

```bash
railway volume add --service api --mount-path /data
```

This is the durable store for `justdoit.db` and `/data/files`. `api` runs a
single replica (set in `apps/api/railway.json`) so there is exactly one writer.

## 3. Generate secrets

```bash
openssl rand -hex 32     # → INTERNAL_API_SECRET (use the SAME value on api, web, mcp)
openssl rand -base64 32  # → AUTH_SECRET (web only)
```

## 4. Create the GitHub OAuth app

GitHub → Settings → Developer settings → OAuth Apps → New:

- Homepage URL: `https://<your-web-domain>` (or the Railway-provided web URL).
- Authorization callback URL: `https://<your-web-domain>/api/auth/callback/github`.
- Copy the **Client ID** and generate a **Client secret**.

(You can revisit the callback URL after step 7 once the custom domain is live.)

## 5. Set service variables

`api`:

```bash
railway variables --service api \
  --set JUSTDOIT_MODE=hosted \
  --set INTERNAL_API_SECRET=<hex32> \
  --set JUSTDOIT_DB=/data/justdoit.db \
  --set JUSTDOIT_FILES_DIR=/data/files \
  --set JUSTDOIT_API_HOST=0.0.0.0
```

`web`:

```bash
railway variables --service web \
  --set JUSTDOIT_MODE=hosted \
  --set AUTH_SECRET=<base64_32> \
  --set AUTH_GITHUB_ID=<client_id> \
  --set AUTH_GITHUB_SECRET=<client_secret> \
  --set AUTH_ALLOWLIST=<your-github-login>[,teammate,...] \
  --set AUTH_URL=https://<your-web-domain> \
  --set INTERNAL_API_URL=http://api.railway.internal:8787 \
  --set INTERNAL_API_SECRET=<hex32> \
  --set NEXT_PUBLIC_API_URL=/api/backend
```

(No `mcp` service — external MCP is served by `api`'s `/mcp` route.)

## 6. Deploy (build & release) each service

Deploy `api` first (it owns the DB / runs migrations), then `web`:

```bash
railway up --service api    # watch logs: "justdoit API listening on http://0.0.0.0:8787"
railway up --service web    # watch logs: Next.js ready on 0.0.0.0:3000
```

Both `api` and `web` get a public domain. **`api` is public but every route
requires auth** (internal key from the web proxy over internal DNS, or a per-user
`X-API-Key`) — there is no anonymous access, and its `/mcp` route is the external
MCP surface. `web` gets the human-facing custom domain.

## 7. Wire the custom domain (web)

Railway → `web` → Settings → Networking → Custom Domain → add
`justdoit.example.com`; create the CNAME it shows at your DNS provider. Once it
resolves, update `AUTH_URL` (step 5) and the GitHub OAuth callback (step 4) to
the custom domain, then redeploy `web` (`railway up --service web`).

## 8. Smoke checklist

See "Post-deploy smoke checklist" below — run every item before declaring go-live.
````

- [ ] **Step 2: Verify the runbook renders and covers each required step**

Run:

```bash
for kw in "railway login" "railway init" "volume add" "openssl rand" "callback/github" "railway up --service api" "Custom Domain" "smoke"; do
  grep -q "$kw" docs/DEPLOY.md && echo "covered: $kw" || echo "MISSING: $kw"
done
```

Expected: eight `covered: …` lines, no `MISSING`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs(deploy): Railway deploy runbook (DEPLOY.md)"
```

---

## Task 9: Post-deploy smoke checklist + isolation proof (append to `docs/DEPLOY.md`)

**Files:**

- Modify: `docs/DEPLOY.md` (append the smoke checklist section)

**Interfaces:**

- Consumes: a live deploy from Task 8.
- Produces: an explicit, ordered checklist the owner runs against the live stack — health, allowlisted sign-in, task creation in the UI, API-key creation, key-gated public API/MCP access, and a **cross-user isolation** check with a second GitHub account (the spec §2 invariant is the go-live gate).

- [ ] **Step 1: Append the smoke checklist to `docs/DEPLOY.md`**

````markdown
## Post-deploy smoke checklist

Run in order against the live deployment. A single failure blocks go-live.

1. **api health + auth-gating.** Health check over internal DNS (from the `api`
   service shell, or `web`'s shell):

   ```bash
   node -e "fetch('http://api.railway.internal:8787/health').then(r=>r.text()).then(console.log)"
   ```

   Expect `{"status":"ok"}`. `api` **does** have a public domain (for external
   `/mcp`), but **every route requires auth** — confirm an anonymous public
   request is rejected:

   ```bash
   curl -fsS -o /dev/null -w "%{http_code}\n" https://<api-public-domain>/projects   # expect 401
   ```

2. **web loads + redirects to sign-in.** Open `https://<your-web-domain>` in a
   private window → you are redirected to GitHub sign-in (unauthenticated users
   never see app data).

3. **Allowlisted sign-in works.** Sign in with a GitHub account **in**
   `AUTH_ALLOWLIST` → you land in the app. A `users` row is created.

4. **Non-allowlisted sign-in is rejected.** Sign in with an account **not** in
   the allowlist → clear "not allowed" screen, no app access, no data created.

5. **Create a task in the UI.** Add a task; reload → it persists (proves the
   web→proxy→api→volume path and on-disk `/data/justdoit.db`).

6. **Create an API key.** Settings → API keys → create one; copy the raw key
   (shown once). Confirm a second load shows only its name/metadata, never the raw key.

7. **Public MCP with the key.** From your laptop, hit `api`'s key-gated `/mcp`
   route on the api public domain:

   ```bash
   curl -fsS https://<api-public-domain>/mcp -X POST \
     -H "X-API-Key: <raw-key>" \
     -H 'content-type: application/json' \
     -H 'accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
   ```

   Expect an MCP `initialize` response (and an `mcp-session-id` header). A request
   with **no**/wrong key → `401`.

8. **Cross-user isolation (the invariant, spec §2).** Sign in as a **second**
   allowlisted account in another browser; create a task there. Then:
   - As user A, list tasks → user B's task is absent.
   - Using user A's API key, request user B's task id → `404` (NotFound),
     never user B's data.

   Both must hold. This is the go-live gate.

9. **Reminders surface in-app.** A task with a past `remindAt` shows the
   due/overdue indicator (container has no desktop notifications; the scheduler
   still marks reminders delivered).
````

- [ ] **Step 2: Verify the checklist covers every required smoke item**

Run:

```bash
for kw in "api health" "Allowlisted sign-in" "Non-allowlisted" "Create a task" "Create an API key" "Public MCP" "Cross-user isolation" "404"; do
  grep -q "$kw" docs/DEPLOY.md && echo "covered: $kw" || echo "MISSING: $kw"
done
```

Expected: eight `covered: …` lines, no `MISSING`.

- [ ] **Step 3: Final workspace gates still pass (local dev unaffected)**

Run:

```bash
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint
```

Expected: all pass — this sub-phase changed only container/config/docs artifacts plus the single `output: 'standalone'` line, so the existing local build/test/lint remain green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(deploy): post-deploy smoke checklist + isolation gate"
```

---

## Phase 7c Definition of Done

- **Runtime approach chosen and justified:** `tsx` for `api` (no bundler), Next.js `output: 'standalone'` for `web`. Documented at the top of this plan. (`apps/mcp` is local-stdio only — not containerized.)
- `apps/api/Dockerfile`, `apps/web/Dockerfile` each **build** from the repo root and produce **non-root**, glibc-based images with correct `EXPOSE`/`CMD`. There is **no `apps/mcp/Dockerfile`** (D1).
- The `api` image **boots, runs migrations against `/data/justdoit.db`, passes its `/health` HEALTHCHECK** (`{"status":"ok"}`), and serves the key-gated `/mcp` route; `better-sqlite3` builds in-image with no ignored-build-script warning.
- The `web` image builds from the standalone output and **boots** serving `:3000`.
- `apps/{api,web}/railway.json` declare the Dockerfile builder + healthchecks; `api` is `numReplicas: 1`; volume/networking/public-domain decisions (api public+auth-gated, serves `/mcp`; web→api over internal DNS; no mcp service) are documented.
- `.env.example` + the env matrix cover every variable per service (local vs hosted); real `.env` files stay git-ignored; secrets live in Railway only.
- `docker-compose.yml` runs the hosted-mode stack locally (web + api) and proves web→api internal reachability (and that api is not host-published in the sim).
- `docs/DEPLOY.md` is a complete owner runbook (login → init → services → volume → secrets → OAuth → `railway up` → custom domain) plus a post-deploy smoke checklist whose gate is the cross-user isolation invariant (spec §2).
- **Local parity:** `pnpm dev` / local file-SQLite mode is unchanged; `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint` pass.

## Go-live checklist

- [ ] Both images build locally (`docker build -f apps/api/Dockerfile .`, `docker build -f apps/web/Dockerfile .`); no `apps/mcp` image.
- [ ] `docker compose up --build api web` → web responds, `api-from-web:{"status":"ok"}`, api not host-reachable in the sim.
- [ ] Railway project created; `api` and `web` services exist (no `mcp` service), each pointed at its `apps/<svc>/railway.json`.
- [ ] Volume attached to `api` at `/data`; `api` is single-replica; `api` gets a public domain but **every route requires auth** (anonymous → 401); `web` gets the human custom domain.
- [ ] Secrets generated (`INTERNAL_API_SECRET` shared across api+web; `AUTH_SECRET` on web) and set as Railway variables; `JUSTDOIT_MODE=hosted` on both services.
- [ ] GitHub OAuth app created; callback = `https://<domain>/api/auth/callback/github`; `AUTH_ALLOWLIST` set.
- [ ] `railway up --service api` then `--service web` succeed; logs show api listening + Next.js ready.
- [ ] Custom domain wired on `web`; `AUTH_URL` + OAuth callback updated to it; web redeployed.
- [ ] Smoke checklist §§1–9 all pass, **including the cross-user isolation gate (§8)** and the key-gated `/mcp` check (§7).

```

```
