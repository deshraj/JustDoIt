import { describe, it, expect } from 'vitest';
import { createDb, runMigrations } from '@justdoit/core';
import { createApp } from '../app';

const SECRET = 'internal-secret';

function app() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return createApp(db, { mode: 'hosted', internalSecret: SECRET });
}

describe('internal user upsert', () => {
  it('upserts by github id (idempotent) with a valid internal key', async () => {
    const a = app();
    const post = (body: unknown) =>
      a.request('/internal/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Internal-Key': SECRET },
        body: JSON.stringify(body),
      });
    const r1 = await post({ githubId: '42', email: 'a@x.dev', name: 'A', avatarUrl: null });
    expect(r1.status).toBe(200);
    const { id } = (await r1.json()) as { id: string };
    const r2 = await post({ githubId: '42', email: 'a@x.dev', name: 'A2', avatarUrl: null });
    expect(((await r2.json()) as { id: string }).id).toBe(id);
  });

  it('rejects a wrong/missing internal key with 401', async () => {
    const res = await app().request('/internal/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Internal-Key': 'nope' },
      body: JSON.stringify({ githubId: '1' }),
    });
    expect(res.status).toBe(401);
  });
});
