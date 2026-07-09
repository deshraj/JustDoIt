import { describe, it, expect } from 'vitest';
import { createDb, runMigrations, userService, apiKeyService } from '@justdoit/core';
import { createApp } from './app';

const SECRET = 'internal-secret';

describe('hosted-mode identity smoke', () => {
  it('proxy identity and per-user keys resolve to the right tenant', async () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const app = createApp(db, { mode: 'hosted', internalSecret: SECRET });

    const a = userService.upsertByGithubId(db, {
      githubId: 'A',
      email: 'a@x.dev',
      name: 'A',
      avatarUrl: null,
    });
    const b = userService.upsertByGithubId(db, {
      githubId: 'B',
      email: 'b@x.dev',
      name: 'B',
      avatarUrl: null,
    });
    const keyA = apiKeyService.create(db, a.id, 'cli').token;

    const proxy = (uid: string, path: string, init: RequestInit = {}) =>
      app.request(path, {
        ...init,
        headers: { 'X-Internal-Key': SECRET, 'X-User-Id': uid, ...(init.headers ?? {}) },
      });

    // A creates a project via the proxy identity.
    const created = await proxy(a.id, '/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A-only' }),
    });
    expect(created.status).toBe(201);
    const project = (await created.json()) as { id: string };

    // B (via proxy) cannot see A's project.
    const bList = (await (await proxy(b.id, '/projects')).json()) as unknown[];
    expect(bList).toHaveLength(0);

    // B cannot fetch A's project by id → NotFound.
    expect((await proxy(b.id, `/projects/${project.id}`)).status).toBe(404);

    // A's API key resolves to A and sees A's project.
    const viaKeyRes = await app.request('/projects', { headers: { 'X-API-Key': keyA } });
    const viaKey = (await viaKeyRes.json()) as unknown[];
    expect(viaKey).toHaveLength(1);

    // No identity at all in hosted mode → 401.
    expect((await app.request('/projects')).status).toBe(401);
  });

  it('the /events SSE stream is filtered to the acting user (no cross-tenant leak)', async () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const app = createApp(db, { mode: 'hosted', internalSecret: SECRET });
    const a = userService.upsertByGithubId(db, {
      githubId: 'A',
      email: 'a@x.dev',
      name: 'A',
      avatarUrl: null,
    });
    const b = userService.upsertByGithubId(db, {
      githubId: 'B',
      email: 'b@x.dev',
      name: 'B',
      avatarUrl: null,
    });

    // Open A's event stream via the proxy identity.
    const stream = await app.request('/events', {
      headers: { 'X-Internal-Key': SECRET, 'X-User-Id': a.id, accept: 'text/event-stream' },
    });
    const reader = stream.body!.getReader();

    // B then A each create a task → one domain event per user.
    const mk = (uid: string, title: string) =>
      app.request('/tasks', {
        method: 'POST',
        headers: { 'X-Internal-Key': SECRET, 'X-User-Id': uid, 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
    await mk(b.id, 'B secret task');
    await mk(a.id, 'A own task');

    // A's stream carries only A's event — B's is never delivered (spec §2, the /events filter from 7a Task 15).
    const chunk = new TextDecoder().decode((await reader.read()).value);
    expect(chunk).toContain('A own task');
    expect(chunk).not.toContain('B secret task');
    await reader.cancel();
  });
});
