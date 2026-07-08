import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This worktree lives nested under the main checkout, which also has a
  // pnpm-lock.yaml; pin the workspace root explicitly so Next's file-tracing
  // doesn't warn about (or trace from) the wrong monorepo root.
  outputFileTracingRoot: path.join(dirname, '../..'),
};

export default nextConfig;
