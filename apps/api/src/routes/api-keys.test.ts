import { describe, it, expect } from 'vitest';
import { createDb, runMigrations, userService } from '@justdoit/core';
import { createApp } from '../app';

const SECRET = 'internal-secret';

function setup() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  const app = createApp(db, { mode: 'hosted', internalSecret: SECRET });
  const user = userService.upsertByGithubId(db, {
    githubId: 'gh1',
    email: 'a@x.dev',
    name: 'A',
    avatarUrl: null,
  });
  const asUser = (path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: { 'X-Internal-Key': SECRET, 'X-User-Id': user.id, ...(init.headers ?? {}) },
    });
  return { db, app, user, asUser };
}

describe('api-keys routes', () => {
  it('creates (raw once), lists (no raw), and revokes a key', async () => {
    const { asUser } = setup();

    const created = await asUser('/api-keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'laptop' }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { raw: string; key: { id: string; name: string } };
    expect(body.raw).toMatch(/.{16,}/);
    expect(body.key.name).toBe('laptop');
    expect('token' in body.key).toBe(false);

    const listed = await asUser('/api-keys');
    const list = (await listed.json()) as { keys: Array<{ id: string; raw?: string }> };
    expect(list.keys).toHaveLength(1);
    expect(list.keys[0]!.raw).toBeUndefined();

    const del = await asUser(`/api-keys/${body.key.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    const afterList = (await (await asUser('/api-keys')).json()) as { keys: unknown[] };
    expect(afterList.keys).toHaveLength(0);
  });

  it('rejects a nameless create with 400', async () => {
    const { asUser } = setup();
    const res = await asUser('/api-keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
  });
});
