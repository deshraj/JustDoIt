import { and, eq, gte, isNotNull, lte } from 'drizzle-orm';
import type { Db } from '../db';
import { projects, tags, taskTags, tasks, timeEntries } from '../db/schema';
import type { TimeReportGroupBy, TimeReportQuery } from '../schemas/report-schema';

export interface TimeReportBucket {
  key: string;
  label: string;
  totalSeconds: number;
  entryCount: number;
}

export interface EstimateVsActual {
  taskId: string;
  title: string;
  estimateMinutes: number | null;
  actualSeconds: number;
  actualMinutes: number;
  varianceMinutes: number | null;
}

export interface TimeReport {
  groupBy: TimeReportGroupBy;
  from: Date | null;
  to: Date | null;
  totalSeconds: number;
  buckets: TimeReportBucket[];
  estimateVsActual: EstimateVsActual[];
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const reportService = {
  /**
   * Aggregate closed time entries (durationSeconds IS NOT NULL) into totals grouped
   * by UTC day / project / tag, plus a per-task estimate-vs-actual breakdown.
   *
   * - `day` buckets key on `startedAt.toISOString().slice(0, 10)` (UTC).
   * - `project` buckets key on projectId; tasks with no project fall into a
   *   synthetic `inbox` / "Inbox" bucket.
   * - `tag` buckets double-count by design: a task with N tags contributes its
   *   full duration to each of the N tag buckets, so bucket totals can exceed
   *   the grand total. Tagless tasks fall into a synthetic `untagged` bucket.
   * - A currently running timer (endedAt IS NULL) contributes nothing until stopped.
   */
  timeReport(db: Db, query: TimeReportQuery): TimeReport {
    const conds = [isNotNull(timeEntries.durationSeconds)];
    if (query.from) conds.push(gte(timeEntries.startedAt, query.from));
    if (query.to) conds.push(lte(timeEntries.startedAt, query.to));

    const rows = db
      .select({
        taskId: timeEntries.taskId,
        startedAt: timeEntries.startedAt,
        durationSeconds: timeEntries.durationSeconds,
        projectId: tasks.projectId,
        title: tasks.title,
        estimateMinutes: tasks.estimateMinutes,
      })
      .from(timeEntries)
      .innerJoin(tasks, eq(timeEntries.taskId, tasks.id))
      .where(and(...conds))
      .all();

    // Lookups needed only for specific groupings.
    const projectNames = new Map<string, string>();
    if (query.groupBy === 'project') {
      for (const p of db.select({ id: projects.id, name: projects.name }).from(projects).all()) {
        projectNames.set(p.id, p.name);
      }
    }
    const tagsByTask = new Map<string, { id: string; name: string }[]>();
    if (query.groupBy === 'tag') {
      const rel = db
        .select({ taskId: taskTags.taskId, tagId: tags.id, tagName: tags.name })
        .from(taskTags)
        .innerJoin(tags, eq(taskTags.tagId, tags.id))
        .all();
      for (const r of rel) {
        const list = tagsByTask.get(r.taskId) ?? [];
        list.push({ id: r.tagId, name: r.tagName });
        tagsByTask.set(r.taskId, list);
      }
    }

    const buckets = new Map<string, TimeReportBucket>();
    const bump = (key: string, label: string, seconds: number): void => {
      const b = buckets.get(key) ?? { key, label, totalSeconds: 0, entryCount: 0 };
      b.totalSeconds += seconds;
      b.entryCount += 1;
      buckets.set(key, b);
    };

    const estMap = new Map<string, EstimateVsActual>();
    let totalSeconds = 0;

    for (const r of rows) {
      const seconds = r.durationSeconds ?? 0;
      totalSeconds += seconds;

      const eva = estMap.get(r.taskId) ?? {
        taskId: r.taskId,
        title: r.title,
        estimateMinutes: r.estimateMinutes ?? null,
        actualSeconds: 0,
        actualMinutes: 0,
        varianceMinutes: null,
      };
      eva.actualSeconds += seconds;
      estMap.set(r.taskId, eva);

      if (query.groupBy === 'day') {
        const key = utcDay(r.startedAt);
        bump(key, key, seconds);
      } else if (query.groupBy === 'project') {
        if (r.projectId) {
          bump(r.projectId, projectNames.get(r.projectId) ?? 'Unknown', seconds);
        } else {
          bump('inbox', 'Inbox', seconds);
        }
      } else {
        const taskTagList = tagsByTask.get(r.taskId) ?? [];
        if (taskTagList.length === 0) {
          bump('untagged', 'Untagged', seconds);
        } else {
          for (const t of taskTagList) bump(t.id, t.name, seconds);
        }
      }
    }

    const estimateVsActual = [...estMap.values()]
      .map((e) => {
        const actualMinutes = Math.round(e.actualSeconds / 60);
        return {
          ...e,
          actualMinutes,
          varianceMinutes: e.estimateMinutes == null ? null : actualMinutes - e.estimateMinutes,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));

    const bucketList = [...buckets.values()].sort((a, b) =>
      query.groupBy === 'day' ? a.key.localeCompare(b.key) : b.totalSeconds - a.totalSeconds,
    );

    return {
      groupBy: query.groupBy,
      from: query.from ?? null,
      to: query.to ?? null,
      totalSeconds,
      buckets: bucketList,
      estimateVsActual,
    };
  },
};
