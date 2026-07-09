import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createDb, runMigrations, userService, apiKeyService, LOCAL_USER_ID } from '@justdoit/core';
import { resolveUser } from './auth';
import type { AppEnv } from '../context';

const SECRET = 'internal-secret';

function harness(mode: 'local' | 'hosted') {
  const { db } = createDb(':memory:');
  runMigrations(db);
  const app = new Hono<AppEnv>();
  app.use('*', resolveUser(db, { internalSecret: SECRET, mode }));
  app.get('/whoami', (c) => c.json({ userId: c.var.ctx.userId }));
  return { db, app };
}

describe('resolveUser', () => {
  it('path 1: valid internal key trusts X-User-Id', async () => {
    const { app } = harness('hosted');
    const res = await app.request('/whoami', {
      headers: { 'X-Internal-Key': SECRET, 'X-User-Id': 'user-A' },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { userId: string }).userId).toBe('user-A');
  });

  it('path 1: wrong internal key → 401', async () => {
    const { app } = harness('hosted');
    const res = await app.request('/whoami', {
      headers: { 'X-Internal-Key': 'nope', 'X-User-Id': 'user-A' },
    });
    expect(res.status).toBe(401);
  });

  it('path 2: valid X-API-Key resolves to its owner', async () => {
    const { db, app } = harness('hosted');
    const user = userService.upsertByGithubId(db, {
      githubId: 'gh1',
      email: 'a@x.dev',
      name: 'A',
      avatarUrl: null,
    });
    const { token } = apiKeyService.create(db, user.id, 'cli');
    const res = await app.request('/whoami', { headers: { 'X-API-Key': token } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { userId: string }).userId).toBe(user.id);
  });

  it('path 2: unknown X-API-Key → 401', async () => {
    const { app } = harness('hosted');
    const res = await app.request('/whoami', { headers: { 'X-API-Key': 'garbage' } });
    expect(res.status).toBe(401);
  });

  it('path 3: local mode with no headers → local-user', async () => {
    const { app } = harness('local');
    const res = await app.request('/whoami');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { userId: string }).userId).toBe(LOCAL_USER_ID);
  });

  it('path 4: hosted mode with no headers → 401', async () => {
    const { app } = harness('hosted');
    const res = await app.request('/whoami');
    expect(res.status).toBe(401);
  });
});
