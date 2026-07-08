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

  describe('API-key auth', () => {
    function appWithKey(apiKey: string): ReturnType<typeof createApp> {
      const { db }: { db: Db } = createDb(':memory:');
      runMigrations(db);
      return createApp(db, { apiKey });
    }

    it('allows all requests when no key is configured', async () => {
      const res = await appWithDb().request('/health');
      expect(res.status).toBe(200);
    });

    it('rejects requests without the key when a key is configured', async () => {
      const res = await appWithKey('secret').request('/health');
      expect(res.status).toBe(401);
    });

    it('rejects requests with a wrong key', async () => {
      const res = await appWithKey('secret').request('/health', {
        headers: { 'X-API-Key': 'nope' },
      });
      expect(res.status).toBe(401);
    });

    it('allows requests carrying the matching key', async () => {
      const res = await appWithKey('secret').request('/health', {
        headers: { 'X-API-Key': 'secret' },
      });
      expect(res.status).toBe(200);
    });
  });
});
