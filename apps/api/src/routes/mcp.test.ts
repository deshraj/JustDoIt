import { describe, it, expect } from 'vitest';
import { createDb, runMigrations, userService, apiKeyService } from '@justdoit/core';
import { createApp } from '../app';

const SECRET = 'internal-secret';

function seedKey() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  const user = userService.upsertByGithubId(db, {
    githubId: 'gh1',
    email: 'a@x.dev',
    name: 'A',
    avatarUrl: null,
  });
  const { token } = apiKeyService.create(db, user.id, 'agent'); // 7a signature: (db, userId, name)
  return { db, user, token };
}

const initBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 's', version: '0' },
  },
});
const headers = (extra: Record<string, string> = {}) => ({
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  ...extra,
});

describe('POST /mcp identity', () => {
  it('hosted mode: initialize without a key → 401 (resolveUser blocks it)', async () => {
    const { db } = seedKey();
    const app = createApp(db, { mode: 'hosted', internalSecret: SECRET });
    const res = await app.request('/mcp', { method: 'POST', headers: headers(), body: initBody });
    expect(res.status).toBe(401);
  });

  it('hosted mode: a valid X-API-Key initializes a session bound to its owner', async () => {
    const { db, token } = seedKey();
    const app = createApp(db, { mode: 'hosted', internalSecret: SECRET });
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: headers({ 'X-API-Key': token }),
      body: initBody,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeTruthy();
  });

  it('local mode: no key → local-user session', async () => {
    const { db } = seedKey();
    const app = createApp(db, { mode: 'local' });
    const res = await app.request('/mcp', { method: 'POST', headers: headers(), body: initBody });
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeTruthy();
  });
});
