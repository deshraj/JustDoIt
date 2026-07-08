import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { tasks } from '@justdoit/core';
import { freshDb, makeClient, firstJson } from './helpers.js';

describe('mcp server bootstrap', () => {
  // NOTE: SDK 1.29.0 only installs the `tools/list` request handler once at
  // least one tool has been registered (see `setToolRequestHandlers` in
  // server/mcp.js) — calling `listTools()` before any tool exists throws
  // "Method not found" instead of returning `[]`. So the pre-Task-2 smoke
  // test asserts the connection handshake succeeded via `getServerVersion()`
  // instead of `listTools()`. `listTools()` is exercised for real starting
  // in Task 2's tests (and the "registers all 17 tools" assertion in Task 6).
  it('connects to the server and completes the handshake', async () => {
    const { client } = await makeClient(freshDb());
    expect(client.getServerVersion()).toEqual({ name: 'justdoit', version: '0.0.0' });
  });
});

describe('task write tools', () => {
  it('create_task inserts a task and returns it', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const res = await client.callTool({
      name: 'create_task',
      arguments: { title: 'Write MCP plan', priority: 'p1' },
    });
    const task = firstJson(res) as { id: string; title: string; priority: string };
    expect(task.title).toBe('Write MCP plan');
    expect(task.priority).toBe('p1');

    const rows = db.select().from(tasks).where(eq(tasks.id, task.id)).all();
    expect(rows).toHaveLength(1);
  });

  it('update_task patches fields', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const created = firstJson(
      await client.callTool({ name: 'create_task', arguments: { title: 'Old' } }),
    ) as { id: string };
    const updated = firstJson(
      await client.callTool({
        name: 'update_task',
        arguments: { id: created.id, title: 'New' },
      }),
    ) as { title: string };
    expect(updated.title).toBe('New');
  });

  it('set_status changes status', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const created = firstJson(
      await client.callTool({ name: 'create_task', arguments: { title: 'T' } }),
    ) as { id: string };
    const res = firstJson(
      await client.callTool({
        name: 'set_status',
        arguments: { id: created.id, status: 'in_progress' },
      }),
    ) as { status: string };
    expect(res.status).toBe('in_progress');
  });

  it('complete_task sets status done and completedAt', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const created = firstJson(
      await client.callTool({ name: 'create_task', arguments: { title: 'T' } }),
    ) as { id: string };
    const res = firstJson(
      await client.callTool({ name: 'complete_task', arguments: { id: created.id } }),
    ) as { status: string; completedAt: unknown };
    expect(res.status).toBe('done');
    expect(res.completedAt).toBeTruthy();
  });

  it('delete_task removes the row', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const created = firstJson(
      await client.callTool({ name: 'create_task', arguments: { title: 'T' } }),
    ) as { id: string };
    await client.callTool({ name: 'delete_task', arguments: { id: created.id } });
    const rows = db.select().from(tasks).where(eq(tasks.id, created.id)).all();
    expect(rows).toHaveLength(0);
  });

  it('create_task with invalid status returns isError', async () => {
    const { client } = await makeClient(freshDb());
    const res = await client.callTool({
      name: 'create_task',
      arguments: { title: 'T', status: 'nope' },
    });
    expect(res.isError).toBe(true);
  });
});

describe('task read tools', () => {
  it('get_task returns a task by id', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const created = firstJson(
      await client.callTool({ name: 'create_task', arguments: { title: 'Find me' } }),
    ) as { id: string };
    const got = firstJson(
      await client.callTool({ name: 'get_task', arguments: { id: created.id } }),
    ) as { title: string };
    expect(got.title).toBe('Find me');
  });

  it('list_tasks filters by status', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    await client.callTool({ name: 'create_task', arguments: { title: 'A', status: 'todo' } });
    await client.callTool({ name: 'create_task', arguments: { title: 'B', status: 'done' } });
    const list = firstJson(
      await client.callTool({ name: 'list_tasks', arguments: { status: 'done' } }),
    ) as { title: string }[];
    expect(list.map((t) => t.title)).toEqual(['B']);
  });

  it('search_tasks matches title text', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    await client.callTool({ name: 'create_task', arguments: { title: 'buy milk' } });
    await client.callTool({ name: 'create_task', arguments: { title: 'call bob' } });
    const list = firstJson(
      await client.callTool({ name: 'search_tasks', arguments: { q: 'milk' } }),
    ) as { title: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe('buy milk');
  });

  it('list_tasks composes `due` with other filters instead of dropping them', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const projA = firstJson(
      await client.callTool({ name: 'create_project', arguments: { name: 'A' } }),
    ) as { id: string };
    const projB = firstJson(
      await client.callTool({ name: 'create_project', arguments: { name: 'B' } }),
    ) as { id: string };
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const dueAt = today.toISOString();
    await client.callTool({
      name: 'create_task',
      arguments: { title: 'A-today', dueAt, projectId: projA.id, status: 'todo' },
    });
    await client.callTool({
      name: 'create_task',
      arguments: { title: 'B-today', dueAt, projectId: projB.id, status: 'todo' },
    });

    const list = firstJson(
      await client.callTool({
        name: 'list_tasks',
        arguments: { due: 'today', projectId: projA.id },
      }),
    ) as { title: string; projectId: string }[];
    expect(list.map((t) => t.title)).toEqual(['A-today']);
    expect(list.every((t) => t.projectId === projA.id)).toBe(true);
  });
});

describe('date-field null handling (no epoch corruption)', () => {
  it('create_task with dueAt: null leaves dueAt null (not 1970)', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const task = firstJson(
      await client.callTool({
        name: 'create_task',
        arguments: { title: 'No due', dueAt: null },
      }),
    ) as { dueAt: unknown };
    expect(task.dueAt).toBeNull();
  });

  it('update_task with dueAt: null clears an existing due date', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const created = firstJson(
      await client.callTool({
        name: 'create_task',
        arguments: { title: 'Has due', dueAt: '2026-08-01T00:00:00.000Z' },
      }),
    ) as { id: string; dueAt: unknown };
    expect(created.dueAt).toBeTruthy();

    const updated = firstJson(
      await client.callTool({
        name: 'update_task',
        arguments: { id: created.id, dueAt: null },
      }),
    ) as { dueAt: unknown };
    expect(updated.dueAt).toBeNull();
  });

  it('update_task with projectId: null clears the project', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const proj = firstJson(
      await client.callTool({ name: 'create_project', arguments: { name: 'P' } }),
    ) as { id: string };
    const created = firstJson(
      await client.callTool({
        name: 'create_task',
        arguments: { title: 'In project', projectId: proj.id },
      }),
    ) as { id: string; projectId: string | null };
    expect(created.projectId).toBe(proj.id);

    const updated = firstJson(
      await client.callTool({
        name: 'update_task',
        arguments: { id: created.id, projectId: null },
      }),
    ) as { projectId: string | null };
    expect(updated.projectId).toBeNull();
  });
});
