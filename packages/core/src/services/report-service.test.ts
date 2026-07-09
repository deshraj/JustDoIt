import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { projects, tags, taskTags, tasks } from '../db/schema';
import { timeService } from './time-service';
import { reportService } from './report-service';
import { taskService } from './task-service';
import { userService } from './user-service';
import { LOCAL_USER_ID } from '../constants';
import type { Ctx } from '../context';

const D1_0900 = new Date('2026-07-08T09:00:00.000Z');
const D1_1000 = new Date('2026-07-08T10:00:00.000Z');
const D2_0900 = new Date('2026-07-09T09:00:00.000Z');

describe('reportService.timeReport', () => {
  let db: Db;
  let ctx: Ctx;
  beforeEach(() => {
    ({ db } = createDb(':memory:'));
    runMigrations(db);
    ctx = { db, userId: LOCAL_USER_ID };
  });

  it('groups by UTC day and sums only closed entries', () => {
    const [t] = db.insert(tasks).values({ title: 'A', estimateMinutes: 30 }).returning().all();
    timeService.logManual(
      ctx,
      { taskId: t!.id, startedAt: D1_0900, durationSeconds: 3600 },
      D1_0900,
    );
    timeService.logManual(
      ctx,
      { taskId: t!.id, startedAt: D2_0900, durationSeconds: 1800 },
      D2_0900,
    );
    // A running timer must NOT be counted.
    timeService.startTimer(ctx, t!.id, D2_0900);

    const report = reportService.timeReport(ctx, { groupBy: 'day' });
    expect(report.totalSeconds).toBe(5400);
    expect(report.buckets).toEqual([
      { key: '2026-07-08', label: '2026-07-08', totalSeconds: 3600, entryCount: 1 },
      { key: '2026-07-09', label: '2026-07-09', totalSeconds: 1800, entryCount: 1 },
    ]);
  });

  it('respects the from/to window on startedAt', () => {
    const [t] = db.insert(tasks).values({ title: 'A' }).returning().all();
    timeService.logManual(
      ctx,
      { taskId: t!.id, startedAt: D1_0900, durationSeconds: 3600 },
      D1_0900,
    );
    timeService.logManual(
      ctx,
      { taskId: t!.id, startedAt: D2_0900, durationSeconds: 1800 },
      D2_0900,
    );
    const report = reportService.timeReport(ctx, {
      groupBy: 'day',
      from: new Date('2026-07-09T00:00:00.000Z'),
    });
    expect(report.totalSeconds).toBe(1800);
  });

  it('groups by project, mapping null project to Inbox', () => {
    const [proj] = db.insert(projects).values({ name: 'Work' }).returning().all();
    const withProj = db
      .insert(tasks)
      .values({ title: 'A', projectId: proj!.id })
      .returning()
      .all()[0]!;
    const noProj = db.insert(tasks).values({ title: 'B' }).returning().all()[0]!;
    timeService.logManual(
      ctx,
      { taskId: withProj.id, startedAt: D1_0900, durationSeconds: 3600 },
      D1_0900,
    );
    timeService.logManual(
      ctx,
      { taskId: noProj.id, startedAt: D1_0900, durationSeconds: 600 },
      D1_0900,
    );

    const report = reportService.timeReport(ctx, { groupBy: 'project' });
    expect(report.buckets[0]).toEqual({
      key: proj!.id,
      label: 'Work',
      totalSeconds: 3600,
      entryCount: 1,
    });
    expect(report.buckets.find((b) => b.key === 'inbox')?.label).toBe('Inbox');
  });

  it('groups by tag, double-counting multi-tag tasks', () => {
    const [t] = db.insert(tasks).values({ title: 'A' }).returning().all();
    const [red] = db.insert(tags).values({ name: 'red' }).returning().all();
    const [blue] = db.insert(tags).values({ name: 'blue' }).returning().all();
    db.insert(taskTags).values({ taskId: t!.id, tagId: red!.id }).run();
    db.insert(taskTags).values({ taskId: t!.id, tagId: blue!.id }).run();
    timeService.logManual(
      ctx,
      { taskId: t!.id, startedAt: D1_0900, durationSeconds: 3600 },
      D1_0900,
    );

    const report = reportService.timeReport(ctx, { groupBy: 'tag' });
    expect(report.totalSeconds).toBe(3600); // grand total counts the entry once
    const byKey = Object.fromEntries(report.buckets.map((b) => [b.label, b.totalSeconds]));
    expect(byKey).toEqual({ red: 3600, blue: 3600 }); // each tag bucket gets the full duration
  });

  it('computes estimate vs actual with variance', () => {
    const [t] = db.insert(tasks).values({ title: 'A', estimateMinutes: 30 }).returning().all();
    timeService.logManual(ctx, { taskId: t!.id, startedAt: D1_0900, endedAt: D1_1000 }, D1_0900);
    const report = reportService.timeReport(ctx, { groupBy: 'day' });
    expect(report.estimateVsActual).toEqual([
      {
        taskId: t!.id,
        title: 'A',
        estimateMinutes: 30,
        actualSeconds: 3600,
        actualMinutes: 60,
        varianceMinutes: 30,
      },
    ]);
  });

  it('report totals exclude B time', () => {
    userService.create(db, { id: 'user-b', name: 'B' });
    const b: Ctx = { db, userId: 'user-b' };
    const aTask = taskService.create(ctx, { title: 'A task' });
    const bTask = taskService.create(b, { title: 'B task' });
    timeService.logManual(ctx, { taskId: aTask.id, startedAt: D1_0900, durationSeconds: 60 }, D1_0900);
    timeService.logManual(b, { taskId: bTask.id, startedAt: D1_0900, durationSeconds: 3600 }, D1_0900);

    const report = reportService.timeReport(ctx, { groupBy: 'day' });
    expect(report.totalSeconds).toBe(60);
    expect(report.estimateVsActual.every((e) => e.taskId !== bTask.id)).toBe(true);
  });
});
