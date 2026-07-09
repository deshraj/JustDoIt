import { and, asc, eq, gt, gte, isNull, lt, lte, notInArray } from 'drizzle-orm';
import { tasks, taskTags, type Task } from '../db/schema';
import { ValidationError } from '../errors';
import { nextOccurrence } from '../recurrence';
import { userScope } from '../scope';
import type { Ctx } from '../context';

const TERMINAL_STATUSES = ['done', 'cancelled'] as const;

export interface ScheduleWindow {
  startAt?: Date | null;
  dueAt?: Date | null;
}

export function assertValidWindow(window: ScheduleWindow): void {
  const { startAt, dueAt } = window;
  if (startAt && dueAt && startAt.getTime() > dueAt.getTime()) {
    throw new ValidationError('startAt must be on or before dueAt');
  }
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

const activeAndDue = () => notInArray(tasks.status, [...TERMINAL_STATUSES]);

export function listOverdue(ctx: Ctx, now: Date): Task[] {
  return ctx.db
    .select()
    .from(tasks)
    .where(and(userScope(tasks, ctx.userId), lt(tasks.dueAt, now), activeAndDue()))
    .orderBy(asc(tasks.dueAt))
    .all();
}

export function listDueToday(ctx: Ctx, now: Date): Task[] {
  return ctx.db
    .select()
    .from(tasks)
    .where(
      and(
        userScope(tasks, ctx.userId),
        gte(tasks.dueAt, startOfLocalDay(now)),
        lte(tasks.dueAt, endOfLocalDay(now)),
        activeAndDue(),
      ),
    )
    .orderBy(asc(tasks.dueAt))
    .all();
}

export function listUpcoming(ctx: Ctx, now: Date, days = 7): Task[] {
  const end = endOfLocalDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  return ctx.db
    .select()
    .from(tasks)
    .where(
      and(
        userScope(tasks, ctx.userId),
        gt(tasks.dueAt, now),
        lte(tasks.dueAt, end),
        activeAndDue(),
      ),
    )
    .orderBy(asc(tasks.dueAt))
    .all();
}

/** Next free position within a project/parent scope (mirrors task-service.create). */
function nextPosition(ctx: Ctx, projectId: string | null, parentTaskId: string | null): number {
  const rows = ctx.db
    .select({ position: tasks.position })
    .from(tasks)
    .where(
      and(
        userScope(tasks, ctx.userId),
        projectId === null ? isNull(tasks.projectId) : eq(tasks.projectId, projectId),
        parentTaskId === null ? isNull(tasks.parentTaskId) : eq(tasks.parentTaskId, parentTaskId),
      ),
    )
    .all();
  return rows.reduce((max, r) => Math.max(max, r.position), 0) + 1;
}

export function spawnNextRecurrence(ctx: Ctx, task: Task, now: Date): Task | null {
  if (!task.recurrence) return null;
  const anchor = task.dueAt ?? task.startAt ?? now;
  const next = nextOccurrence(task.recurrence, anchor);
  if (!next) return null;
  const delta = next.getTime() - anchor.getTime();
  const [created] = ctx.db
    .insert(tasks)
    .values({
      userId: ctx.userId,
      title: task.title,
      description: task.description,
      status: 'todo',
      priority: task.priority,
      projectId: task.projectId,
      parentTaskId: task.parentTaskId,
      // Fresh position so the new occurrence doesn't collide with the completed one.
      position: nextPosition(ctx, task.projectId, task.parentTaskId),
      estimateMinutes: task.estimateMinutes,
      recurrence: task.recurrence,
      dueAt: task.dueAt ? new Date(task.dueAt.getTime() + delta) : null,
      startAt: task.startAt ? new Date(task.startAt.getTime() + delta) : null,
      completedAt: null,
    })
    .returning()
    .all();
  if (!created) return null;
  // Carry the source task's tag associations onto the new occurrence.
  const sourceTags = ctx.db
    .select({ tagId: taskTags.tagId })
    .from(taskTags)
    .where(eq(taskTags.taskId, task.id))
    .all();
  if (sourceTags.length) {
    ctx.db
      .insert(taskTags)
      .values(sourceTags.map((t) => ({ taskId: created.id, tagId: t.tagId })))
      .run();
  }
  return created;
}
