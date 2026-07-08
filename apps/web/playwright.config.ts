import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import {
  API_BASE_URL,
  E2E_API_PORT,
  E2E_DB_PATH,
  E2E_WEB_PORT,
  WEB_BASE_URL,
} from './e2e/fixtures';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '../..');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  globalTeardown: './e2e/fixtures.ts',
  use: {
    baseURL: WEB_BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Spread AFTER the device profile: devices['Desktop Chrome'] carries
        // its own 1280x720 viewport that would otherwise win. Wide enough
        // that all 6 Kanban columns fit without horizontal scroll — the drag
        // source and drop target must both be on-screen at once.
        viewport: { width: 2000, height: 1000 },
      },
    },
  ],
  webServer: [
    {
      // Real apps/api, bound to a throwaway SQLite file so the e2e run never
      // touches a developer's actual justdoit.db.
      command: 'pnpm --filter @justdoit/api start',
      cwd: repoRoot,
      env: {
        JUSTDOIT_DB: E2E_DB_PATH,
        JUSTDOIT_API_PORT: String(E2E_API_PORT),
        JUSTDOIT_DISABLE_SCHEDULER: '1',
      },
      url: `${API_BASE_URL}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // apps/web dev server, pointed at the api instance above.
      command: `pnpm exec next dev -p ${E2E_WEB_PORT}`,
      cwd: dirname,
      env: {
        NEXT_PUBLIC_API_URL: API_BASE_URL,
      },
      url: `${WEB_BASE_URL}/tasks`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
