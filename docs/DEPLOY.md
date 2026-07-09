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
