import { describe, it, expect } from 'vitest';
import { freshDb, makeClient, firstJson } from './helpers.js';

// NOTE: `readResource()`'s content items are a text/blob union; `text` only exists
// on the text variant, so this narrows via `unknown` rather than typing the
// parameter directly (see `firstJson` in ./helpers.ts for the same pattern).
function readJson(result: unknown): unknown {
  const contents = (result as { contents?: { text?: string }[] } | undefined)?.contents;
  const text = contents?.[0]?.text;
  return text ? JSON.parse(text) : undefined;
}

describe('resources', () => {
  it('lists the fixed resources', async () => {
    const { client } = await makeClient(freshDb());
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain('tasks://today');
    expect(uris).toContain('tasks://overdue');
  });

  it('reads a task by uri', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const task = firstJson(
      await client.callTool({ name: 'create_task', arguments: { title: 'Resource me' } }),
    ) as { id: string };
    const res = await client.readResource({ uri: `task://${task.id}` });
    const body = readJson(res) as { title: string };
    expect(body.title).toBe('Resource me');
  });

  it('reads overdue tasks', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    await client.callTool({
      name: 'create_task',
      arguments: { title: 'Past due', dueAt: '2020-01-01T00:00:00.000Z', status: 'todo' },
    });
    const res = await client.readResource({ uri: 'tasks://overdue' });
    const body = readJson(res) as { title: string }[];
    expect(body.some((t) => t.title === 'Past due')).toBe(true);
  });

  it('reads project by uri', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const proj = firstJson(
      await client.callTool({ name: 'create_project', arguments: { name: 'Home' } }),
    ) as { id: string };
    const res = await client.readResource({ uri: `project://${proj.id}` });
    const body = readJson(res) as { name: string };
    expect(body.name).toBe('Home');
  });

  it('reads tasks due today', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    await client.callTool({
      name: 'create_task',
      arguments: { title: 'Due today', dueAt: today.toISOString(), status: 'todo' },
    });
    const res = await client.readResource({ uri: 'tasks://today' });
    const body = readJson(res) as { title: string }[];
    expect(body.some((t) => t.title === 'Due today')).toBe(true);
  });

  it('reading a nonexistent task:// resource returns a JSON-RPC error, not a crash', async () => {
    const { client } = await makeClient(freshDb());
    await expect(
      client.readResource({ uri: 'task://00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow();
  });

  it('excludes done tasks from tasks://overdue', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const created = firstJson(
      await client.callTool({
        name: 'create_task',
        arguments: {
          title: 'Done but overdue',
          dueAt: '2020-01-01T00:00:00.000Z',
          status: 'todo',
        },
      }),
    ) as { id: string };
    await client.callTool({ name: 'complete_task', arguments: { id: created.id } });
    const res = await client.readResource({ uri: 'tasks://overdue' });
    const body = readJson(res) as { title: string }[];
    expect(body.some((t) => t.title === 'Done but overdue')).toBe(false);
  });
});
