import { describe, it, expect } from 'vitest';
import { timeEntries } from '@justdoit/core';
import { eq } from 'drizzle-orm';
import { freshDb, makeClient, firstJson } from './helpers.js';

async function makeTask(client: Awaited<ReturnType<typeof makeClient>>['client']) {
  return firstJson(
    await client.callTool({ name: 'create_task', arguments: { title: 'Timed' } }),
  ) as { id: string };
}

describe('time tools', () => {
  it('start_timer then stop_timer records an entry', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const task = await makeTask(client);

    await client.callTool({ name: 'start_timer', arguments: { taskId: task.id } });
    const stopped = firstJson(
      await client.callTool({ name: 'stop_timer', arguments: { taskId: task.id } }),
    ) as { endedAt: unknown };
    expect(stopped.endedAt).toBeTruthy();

    const rows = db.select().from(timeEntries).where(eq(timeEntries.taskId, task.id)).all();
    expect(rows).toHaveLength(1);
  });

  it('log_time creates a manual entry', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const task = await makeTask(client);
    const entry = firstJson(
      await client.callTool({
        name: 'log_time',
        arguments: { taskId: task.id, minutes: 30, note: 'design' },
      }),
    ) as { source: string; durationSeconds: number };
    expect(entry.source).toBe('manual');
    expect(entry.durationSeconds).toBe(1800);
  });

  it('log_time allows a zero-minute entry (mirrors core nonnegative)', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const task = await makeTask(client);
    const res = await client.callTool({
      name: 'log_time',
      arguments: { taskId: task.id, minutes: 0 },
    });
    expect(res.isError).toBeFalsy();
    const entry = firstJson(res) as { durationSeconds: number };
    expect(entry.durationSeconds).toBe(0);
  });

  it('get_time_report reflects a logged entry in buckets and totals', async () => {
    const db = freshDb();
    const { client } = await makeClient(db);
    const task = await makeTask(client);
    await client.callTool({ name: 'log_time', arguments: { taskId: task.id, minutes: 15 } });
    const report = firstJson(
      await client.callTool({ name: 'get_time_report', arguments: { groupBy: 'project' } }),
    ) as {
      groupBy: string;
      totalSeconds: number;
      buckets: { key: string; totalSeconds: number; entryCount: number }[];
    };
    expect(report.groupBy).toBe('project');
    // 15 minutes = 900 seconds tracked overall.
    expect(report.totalSeconds).toBe(900);
    // The (project-less) task falls into the synthetic "inbox" bucket.
    expect(report.buckets).toHaveLength(1);
    const [bucket] = report.buckets;
    expect(bucket!.key).toBe('inbox');
    expect(bucket!.totalSeconds).toBe(900);
    expect(bucket!.entryCount).toBe(1);
  });
});
