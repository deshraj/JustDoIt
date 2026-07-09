import { describe, it, expect } from 'vitest';
import { createDb, runMigrations, type Db } from '@justdoit/core';
import { createApp } from './app';

function appWithDb(): ReturnType<typeof createApp> {
  const { db }: { db: Db } = createDb(':memory:');
  runMigrations(db);
  return createApp(db);
}

describe('api app', () => {
  it('responds to GET /health', async () => {
    const app = appWithDb();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('returns 404 JSON for an unknown route', async () => {
    const app = appWithDb();
    const res = await app.request('/nope');
    expect(res.status).toBe(404);
  });

  describe('/health is public (no identity required)', () => {
    it('is reachable with no headers in local mode', async () => {
      const res = await appWithDb().request('/health');
      expect(res.status).toBe(200);
    });

    it('is reachable with no headers even in hosted mode (mounted before resolveUser)', async () => {
      const { db }: { db: Db } = createDb(':memory:');
      runMigrations(db);
      const app = createApp(db, { mode: 'hosted', internalSecret: 'secret' });
      const res = await app.request('/health');
      expect(res.status).toBe(200);
    });
  });
});
