import { and, or, eq, gte, lte, asc, isNull, like, inArray, type SQL } from 'drizzle-orm';
import type { Db } from '../db';
import {
  tasks,
  taskTags,
  projects,
  type Task,
  type TaskStatus,
  type TaskPriority,
} from '../db/schema';
import { NotFoundError, ConflictError } from '../errors';
import {
  createTaskSchema,
  updateTaskSchema,
  type CreateTaskInput,
  type UpdateTaskInput,
} from '../schemas';
import { assertValidWindow, spawnNextRecurrence } from './schedule-service';
import { assertValidRecurrence } from '../recurrence';
import type { DueFilter } from '../schemas/schedule';
import { emit } from '../events/emit';

export interface TaskListFilters {
  status?: TaskStatus;
  projectId?: string | null;
  tagId?: string;
  priority?: TaskPriority;
  parentTaskId?: string | null;
  archived?: boolean;
  search?: string;
  // Not applied by `taskService.list` directly — REST short-circuits to
  // schedule-service's clock-injected window queries when `due` is set
  // (see apps/api/src/routes/tasks.ts). Kept on the shared filter shape so
  // callers (REST, future MCP) have one canonical task-list query surface.
  due?: DueFilter;
  /**
   * Arbitrary due-date window (inclusive), independent of `due` above —
   * `due` is relative to "now" (overdue/today/upcoming); this is an absolute
   * range used by callers like the web Calendar view to page through
   * specific months. Exposed over REST as `due_from`/`due_to`.
   */
  dueFrom?: Date;
  dueTo?: Date;
}

function nextPosition(db: Db, projectId: string | null, parentTaskId: string | null): number {
  const rows = db
    .select({ position: tasks.position })
    .from(tasks)
    .where(
      and(
        projectId === null ? isNull(tasks.projectId) : eq(tasks.projectId, projectId),
        parentTaskId === null ? isNull(tasks.parentTaskId) : eq(tasks.parentTaskId, parentTaskId),
      ),
    )
    .all();
  return rows.reduce((max, r) => Math.max(max, r.position), 0) + 1;
}

function requireProject(db: Db, projectId: string): void {
  const row = db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get();
  if (!row) throw new NotFoundError('Project', projectId);
}

export const taskService = {
  create(db: Db, input: CreateTaskInput): Task {
    const parsed = createTaskSchema.parse(input);
    if (parsed.projectId) requireProject(db, parsed.projectId);
    if (parsed.parentTaskId) {
      const parent = taskService.get(db, parsed.parentTaskId);
      if (parent.parentTaskId) {
        throw new ConflictError('Subtasks may only be one level deep');
      }
    }
    assertValidWindow({ startAt: parsed.startAt ?? null, dueAt: parsed.dueAt ?? null });
    if (parsed.recurrence != null) assertValidRecurrence(parsed.recurrence);
    const position = nextPosition(db, parsed.projectId ?? null, parsed.parentTaskId ?? null);
    const [row] = db
      .insert(tasks)
      .values({ ...parsed, position })
      .returning()
      .all();
    emit('task', row!.id, 'created', { title: row!.title });
    return row!;
  },

  get(db: Db, id: string): Task {
    const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!row) throw new NotFoundError('Task', id);
    return row;
  },

  list(db: Db, filters: TaskListFilters = {}): Task[] {
    const conditions: SQL[] = [];
    if (filters.status) conditions.push(eq(tasks.status, filters.status));
    if (filters.priority) conditions.push(eq(tasks.priority, filters.priority));
    if (filters.projectId !== undefined) {
      conditions.push(
        filters.projectId === null
          ? isNull(tasks.projectId)
          : eq(tasks.projectId, filters.projectId),
      );
    }
    if (filters.parentTaskId !== undefined) {
      conditions.push(
        filters.parentTaskId === null
          ? isNull(tasks.parentTaskId)
          : eq(tasks.parentTaskId, filters.parentTaskId),
      );
    }
    if (filters.archived !== undefined) conditions.push(eq(tasks.archived, filters.archived));
    if (filters.dueFrom) conditions.push(gte(tasks.dueAt, filters.dueFrom));
    if (filters.dueTo) conditions.push(lte(tasks.dueAt, filters.dueTo));
    if (filters.search) {
      const needle = `%${filters.search}%`;
      conditions.push(or(like(tasks.title, needle), like(tasks.description, needle))!);
    }
    if (filters.tagId) {
      const taskIds = db
        .select({ id: taskTags.taskId })
        .from(taskTags)
        .where(eq(taskTags.tagId, filters.tagId))
        .all()
        .map((r) => r.id);
      conditions.push(inArray(tasks.id, taskIds.length ? taskIds : ['__none__']));
    }
    return db
      .select()
      .from(tasks)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(tasks.position), asc(tasks.createdAt))
      .all();
  },

  update(db: Db, id: string, patch: UpdateTaskInput): Task {
    const parsed = updateTaskSchema.parse(patch);
    const existing = taskService.get(db, id);
    if (parsed.projectId) requireProject(db, parsed.projectId);
    assertValidWindow({
      startAt: 'startAt' in parsed ? (parsed.startAt ?? null) : existing.startAt,
      dueAt: 'dueAt' in parsed ? (parsed.dueAt ?? null) : existing.dueAt,
    });
    if (parsed.recurrence != null) assertValidRecurrence(parsed.recurrence);
    const [row] = db
      .update(tasks)
      .set({ ...parsed, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning()
      .all();
    emit('task', row!.id, 'updated', { patch });
    return row!;
  },

  setStatus(db: Db, id: string, status: TaskStatus): Task {
    const previous = taskService.get(db, id);
    const completedAt = status === 'done' || status === 'cancelled' ? new Date() : null;
    const [row] = db
      .update(tasks)
      .set({ status, completedAt, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning()
      .all();
    emit('task', row!.id, 'status_changed', { from: previous.status, to: row!.status });
    return row!;
  },

  complete(db: Db, id: string, now: Date = new Date()): Task {
    // Capture the pre-completion row so the recurrence anchor uses the
    // original recurrence/dueAt, not the post-completion state.
    const task = taskService.get(db, id);
    const completed = taskService.setStatus(db, id, 'done');
    spawnNextRecurrence(db, task, now);
    emit('task', completed.id, 'completed', {});
    return completed;
  },

  remove(db: Db, id: string): void {
    taskService.get(db, id);
    db.delete(tasks).where(eq(tasks.id, id)).run();
    emit('task', id, 'deleted', {});
  },

  addSubtask(db: Db, parentId: string, input: CreateTaskInput): Task {
    const parent = taskService.get(db, parentId);
    if (parent.parentTaskId) {
      throw new ConflictError('Subtasks may only be one level deep');
    }
    return taskService.create(db, { ...input, parentTaskId: parentId });
  },

  listSubtasks(db: Db, parentId: string): Task[] {
    return db
      .select()
      .from(tasks)
      .where(eq(tasks.parentTaskId, parentId))
      .orderBy(asc(tasks.position), asc(tasks.createdAt))
      .all();
  },
};
