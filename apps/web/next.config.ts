import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (.next/standalone) for a small
  // container image (Phase 7c).
  output: 'standalone',
  // This worktree lives nested under the main checkout, which also has a
  // pnpm-lock.yaml; pin the workspace root explicitly so Next's file-tracing
  // doesn't warn about (or trace from) the wrong monorepo root. This also
  // makes the standalone bundle mirror the workspace layout (server.js lands
  // at apps/web/server.js), which the web Dockerfile relies on.
  outputFileTracingRoot: path.join(dirname, '../..'),
};

export default nextConfig;
