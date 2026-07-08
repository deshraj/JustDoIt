import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test as base, expect } from '@playwright/test';

/**
 * Shared constants for the two-server e2e setup (see playwright.config.ts):
 * a real `apps/api` on a throwaway SQLite DB + a dedicated port, and the
 * `apps/web` dev server pointed at it via NEXT_PUBLIC_API_URL. Using fixed,
 * non-default ports (not 8787/3000) keeps this from colliding with a
 * developer's own `pnpm dev` session running alongside the test run.
 */
export const E2E_API_PORT = 8788;
export const E2E_WEB_PORT = 3100;
export const API_BASE_URL = `http://localhost:${E2E_API_PORT}`;
export const WEB_BASE_URL = `http://localhost:${E2E_WEB_PORT}`;

/** A fresh temp-file SQLite path per test run (never reused, never committed). */
export const E2E_DB_PATH = path.join(os.tmpdir(), `justdoit-e2e-${process.pid}-${Date.now()}.db`);

/** Poll the API's health endpoint until it responds (belt-and-suspenders on
 * top of Playwright's own `webServer.url` readiness check). */
export async function waitForApiReady(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // Not up yet — keep polling.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`API at ${baseUrl} did not become ready within ${timeoutMs}ms`);
}

export const test = base;
export { expect };

/** Playwright globalTeardown: delete the throwaway DB + its WAL/SHM siblings. */
export default async function globalTeardown(): Promise<void> {
  for (const suffix of ['', '-shm', '-wal']) {
    try {
      fs.unlinkSync(E2E_DB_PATH + suffix);
    } catch {
      // Already gone, or never created — fine either way.
    }
  }
}
