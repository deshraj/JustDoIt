import { describe, it, expect } from 'vitest';
import { reminders } from '@justdoit/core';
import { eq } from 'drizzle-orm';
import { freshDb, makeClient, firstJson } from './helpers.js';

describe('quick_add tool', () => {
  it('parses natural language into a task', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const task = firstJson(
      await client.callTool({
        name: 'quick_add',
        arguments: { text: 'buy milk tomorrow 5pm #errands p1' },
      }),
    ) as { id: string; title: string; priority: string | null };
    expect(task.title.toLowerCase()).toContain('milk');
  });
});

describe('set_reminder tool', () => {
  it('creates a reminder for a task', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const task = firstJson(
      await client.callTool({ name: 'create_task', arguments: { title: 'Remind me' } }),
    ) as { id: string };
    const rem = firstJson(
      await client.callTool({
        name: 'set_reminder',
        arguments: { taskId: task.id, remindAt: '2026-07-09T17:00:00.000Z' },
      }),
    ) as { id: string };
    expect(rem.id).toBeTruthy();

    const rows = db.select().from(reminders).where(eq(reminders.taskId, task.id)).all();
    expect(rows).toHaveLength(1);
  });
});

describe('tool registry', () => {
  it('registers all 17 tools', async () => {
    const { client } = await makeClient(freshDb());
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'add_tag',
        'complete_task',
        'create_project',
        'create_task',
        'delete_task',
        'get_task',
        'get_time_report',
        'list_projects',
        'list_tasks',
        'log_time',
        'quick_add',
        'search_tasks',
        'set_reminder',
        'set_status',
        'start_timer',
        'stop_timer',
        'update_task',
      ].sort(),
    );
  });
});
