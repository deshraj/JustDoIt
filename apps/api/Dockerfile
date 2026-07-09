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
# Non-root user; `gosu` lets the entrypoint fix volume ownership as root, then
# drop to `app`. (The runtime-mounted volume overrides any build-time chown.)
RUN apt-get update && apt-get install -y --no-install-recommends gosu \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r app && useradd -r -g app -d /app app \
  && mkdir -p /data/files && chown -R app:app /data /app \
  && chmod +x /app/apps/api/docker-entrypoint.sh
ENV JUSTDOIT_API_HOST=0.0.0.0 \
    JUSTDOIT_API_PORT=8787 \
    JUSTDOIT_DB=/data/justdoit.db \
    JUSTDOIT_FILES_DIR=/data/files
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.JUSTDOIT_API_PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Runs as root, chowns the mounted volume, then exec's the server as `app` (gosu).
ENTRYPOINT ["/app/apps/api/docker-entrypoint.sh"]
CMD ["pnpm", "--filter", "@justdoit/api", "start"]
