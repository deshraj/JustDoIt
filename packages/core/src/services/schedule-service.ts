import { and, asc, gt, gte, lt, lte, notInArray } from 'drizzle-orm';
import type { Db } from '../db';
import { tasks, type Task } from '../db/schema';
import { ValidationError } from '../errors';
import { nextOccurrence } from '../recurrence';

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

export function listOverdue(db: Db, now: Date): Task[] {
  return db
    .select()
    .from(tasks)
    .where(and(lt(tasks.dueAt, now), activeAndDue()))
    .orderBy(asc(tasks.dueAt))
    .all();
}

export function listDueToday(db: Db, now: Date): Task[] {
  return db
    .select()
    .from(tasks)
    .where(
      and(
        gte(tasks.dueAt, startOfLocalDay(now)),
        lte(tasks.dueAt, endOfLocalDay(now)),
        activeAndDue(),
      ),
    )
    .orderBy(asc(tasks.dueAt))
    .all();
}

export function listUpcoming(db: Db, now: Date, days = 7): Task[] {
  const end = endOfLocalDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  return db
    .select()
    .from(tasks)
    .where(and(gt(tasks.dueAt, now), lte(tasks.dueAt, end), activeAndDue()))
    .orderBy(asc(tasks.dueAt))
    .all();
}

export function spawnNextRecurrence(db: Db, task: Task, now: Date): Task | null {
  if (!task.recurrence) return null;
  const anchor = task.dueAt ?? task.startAt ?? now;
  const next = nextOccurrence(task.recurrence, anchor);
  if (!next) return null;
  const delta = next.getTime() - anchor.getTime();
  const [created] = db
    .insert(tasks)
    .values({
      title: task.title,
      description: task.description,
      status: 'todo',
      priority: task.priority,
      projectId: task.projectId,
      parentTaskId: task.parentTaskId,
      position: task.position,
      estimateMinutes: task.estimateMinutes,
      recurrence: task.recurrence,
      dueAt: task.dueAt ? new Date(task.dueAt.getTime() + delta) : null,
      startAt: task.startAt ? new Date(task.startAt.getTime() + delta) : null,
      completedAt: null,
    })
    .returning()
    .all();
  return created ?? null;
}
