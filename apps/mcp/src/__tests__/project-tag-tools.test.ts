import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { tags } from '@justdoit/core';
import { freshDb, makeClient, firstJson } from './helpers.js';

describe('project tools', () => {
  it('create_project + list_projects', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const proj = firstJson(
      await client.callTool({
        name: 'create_project',
        arguments: { name: 'Work', color: '#f00' },
      }),
    ) as { id: string; name: string };
    expect(proj.name).toBe('Work');

    const list = firstJson(await client.callTool({ name: 'list_projects', arguments: {} })) as {
      id: string;
    }[];
    expect(list.some((p) => p.id === proj.id)).toBe(true);
  });
});

describe('tag tools', () => {
  it('add_tag attaches a tag to a task', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const task = firstJson(
      await client.callTool({ name: 'create_task', arguments: { title: 'Tagged' } }),
    ) as { id: string };
    const res = firstJson(
      await client.callTool({
        name: 'add_tag',
        arguments: { taskId: task.id, name: 'errands', color: '#0f0' },
      }),
    ) as unknown;
    expect(res).toBeTruthy();

    // Side effect: listing tasks filtered by tag returns the task.
    const byTag = firstJson(
      await client.callTool({ name: 'list_tasks', arguments: { tag: 'errands' } }),
    ) as { id: string }[];
    expect(byTag.some((t) => t.id === task.id)).toBe(true);
  });

  it('add_tag reuses an existing tag by name instead of erroring on duplicate', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const task1 = firstJson(
      await client.callTool({ name: 'create_task', arguments: { title: 'One' } }),
    ) as { id: string };
    const task2 = firstJson(
      await client.callTool({ name: 'create_task', arguments: { title: 'Two' } }),
    ) as { id: string };

    const first = await client.callTool({
      name: 'add_tag',
      arguments: { taskId: task1.id, name: 'shared' },
    });
    expect(first.isError).toBeFalsy();

    const second = await client.callTool({
      name: 'add_tag',
      arguments: { taskId: task2.id, name: 'shared' },
    });
    expect(second.isError).toBeFalsy();

    const byTag = firstJson(
      await client.callTool({ name: 'list_tasks', arguments: { tag: 'shared' } }),
    ) as { id: string }[];
    expect(byTag.map((t) => t.id).sort()).toEqual([task1.id, task2.id].sort());
  });

  it('add_tag on a missing task errors and does not orphan a tag row', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const res = await client.callTool({
      name: 'add_tag',
      arguments: { taskId: 'missing', name: 'brandnew' },
    });
    expect(res.isError).toBe(true);
    // No `brandnew` tag row should have been created.
    const rows = db.select().from(tags).where(eq(tags.name, 'brandnew')).all();
    expect(rows).toHaveLength(0);
  });
});
