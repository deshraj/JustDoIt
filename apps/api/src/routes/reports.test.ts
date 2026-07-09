import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDb,
  runMigrations,
  tasks,
  timeService,
  LOCAL_USER_ID,
  type Db,
} from '@justdoit/core';
import { createApp } from '../app';

interface TimeReportBucketJson {
  key: string;
  label: string;
  totalSeconds: number;
  entryCount: number;
}

interface EstimateVsActualJson {
  taskId: string;
  title: string;
  estimateMinutes: number | null;
  actualSeconds: number;
  actualMinutes: number;
  varianceMinutes: number | null;
}

interface TimeReportJson {
  groupBy: string;
  from: string | null;
  to: string | null;
  totalSeconds: number;
  buckets: TimeReportBucketJson[];
  estimateVsActual: EstimateVsActualJson[];
}

let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  ({ db } = createDb(':memory:'));
  runMigrations(db);
  app = createApp(db);
});

describe('GET /reports/time', () => {
  it('returns totals grouped by day plus estimate-vs-actual', async () => {
    const [t] = db
      .insert(tasks)
      .values({ userId: LOCAL_USER_ID, title: 'A', estimateMinutes: 30 })
      .returning()
      .all();
    timeService.logManual(
      { db, userId: LOCAL_USER_ID },
      { taskId: t!.id, startedAt: new Date('2026-07-08T09:00:00.000Z'), durationSeconds: 3600 },
      new Date('2026-07-08T09:00:00.000Z'),
    );

    const res = await app.request('/reports/time?group_by=day');
    expect(res.status).toBe(200);
    const report = (await res.json()) as TimeReportJson;
    expect(report.groupBy).toBe('day');
    expect(report.totalSeconds).toBe(3600);
    expect(report.buckets[0]).toMatchObject({ key: '2026-07-08', totalSeconds: 3600 });
    expect(report.estimateVsActual[0]).toMatchObject({
      estimateMinutes: 30,
      actualMinutes: 60,
      varianceMinutes: 30,
    });
  });

  it('rejects a missing group_by with 400', async () => {
    const res = await app.request('/reports/time');
    expect(res.status).toBe(400);
  });

  it('honors the from window', async () => {
    const [t] = db.insert(tasks).values({ userId: LOCAL_USER_ID, title: 'A' }).returning().all();
    timeService.logManual(
      { db, userId: LOCAL_USER_ID },
      { taskId: t!.id, startedAt: new Date('2026-07-08T09:00:00.000Z'), durationSeconds: 600 },
      new Date('2026-07-08T09:00:00.000Z'),
    );
    const res = await app.request('/reports/time?group_by=day&from=2026-07-09T00:00:00.000Z');
    const report = (await res.json()) as TimeReportJson;
    expect(report.totalSeconds).toBe(0);
  });
});
