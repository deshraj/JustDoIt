import { and, or, eq, gte, lte, asc, isNull, like, inArray, type SQL } from 'drizzle-orm';
import {
  tasks,
  taskTags,
  projects,
  type Task,
  type TaskStatus,
  type TaskPriority,
} from '../db/schema';
import { NotFoundError, ConflictError, ValidationError } from '../errors';
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
import { userScope } from '../scope';
import type { Ctx } from '../context';

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

export interface BulkPatch {
  status?: TaskStatus;
  priority?: TaskPriority | null;
  projectId?: string | null;
  addTagIds?: string[];
  removeTagIds?: string[];
}

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

function requireProject(ctx: Ctx, projectId: string): void {
  const row = ctx.db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), userScope(projects, ctx.userId)))
    .get();
  if (!row) throw new NotFoundError('Project', projectId);
}

export const taskService = {
  create(ctx: Ctx, input: CreateTaskInput): Task {
    const parsed = createTaskSchema.parse(input);
    if (parsed.projectId) requireProject(ctx, parsed.projectId);
    if (parsed.parentTaskId) {
      const parent = taskService.get(ctx, parsed.parentTaskId); // owned-or-404
      if (parent.parentTaskId) {
        throw new ConflictError('Subtasks may only be one level deep');
      }
    }
    assertValidWindow({ startAt: parsed.startAt ?? null, dueAt: parsed.dueAt ?? null });
    if (parsed.recurrence != null) assertValidRecurrence(parsed.recurrence);
    const position = nextPosition(ctx, parsed.projectId ?? null, parsed.parentTaskId ?? null);
    const [row] = ctx.db
      .insert(tasks)
      .values({ ...parsed, userId: ctx.userId, position })
      .returning()
      .all();
    emit(ctx.userId, 'task', row!.id, 'created', { title: row!.title });
    return row!;
  },

  get(ctx: Ctx, id: string): Task {
    const row = ctx.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), userScope(tasks, ctx.userId)))
      .get();
    if (!row) throw new NotFoundError('Task', id);
    return row;
  },

  list(ctx: Ctx, filters: TaskListFilters = {}): Task[] {
    const conditions: SQL[] = [userScope(tasks, ctx.userId)];
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
      const taskIds = ctx.db
        .select({ id: taskTags.taskId })
        .from(taskTags)
        .where(eq(taskTags.tagId, filters.tagId))
        .all()
        .map((r) => r.id);
      conditions.push(inArray(tasks.id, taskIds.length ? taskIds : ['__none__']));
    }
    return ctx.db
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(asc(tasks.position), asc(tasks.createdAt))
      .all();
  },

  update(ctx: Ctx, id: string, patch: UpdateTaskInput): Task {
    const parsed = updateTaskSchema.parse(patch);
    const existing = taskService.get(ctx, id);
    if (parsed.projectId) requireProject(ctx, parsed.projectId);
    assertValidWindow({
      startAt: 'startAt' in parsed ? (parsed.startAt ?? null) : existing.startAt,
      dueAt: 'dueAt' in parsed ? (parsed.dueAt ?? null) : existing.dueAt,
    });
    if (parsed.recurrence != null) assertValidRecurrence(parsed.recurrence);
    const [row] = ctx.db
      .update(tasks)
      .set({ ...parsed, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), userScope(tasks, ctx.userId)))
      .returning()
      .all();
    emit(ctx.userId, 'task', row!.id, 'updated', { patch });
    return row!;
  },

  setStatus(ctx: Ctx, id: string, status: TaskStatus): Task {
    const previous = taskService.get(ctx, id);
    const completedAt = status === 'done' || status === 'cancelled' ? new Date() : null;
    const [row] = ctx.db
      .update(tasks)
      .set({ status, completedAt, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), userScope(tasks, ctx.userId)))
      .returning()
      .all();
    emit(ctx.userId, 'task', row!.id, 'status_changed', { from: previous.status, to: row!.status });
    return row!;
  },

  complete(ctx: Ctx, id: string, now: Date = new Date()): Task {
    // Capture the pre-completion row so the recurrence anchor uses the
    // original recurrence/dueAt, not the post-completion state.
    const task = taskService.get(ctx, id);
    // Idempotent: if the task is already terminal, do not re-transition or spawn
    // another recurrence — otherwise completing twice double-spawns occurrences.
    if (task.status === 'done' || task.status === 'cancelled') {
      return task;
    }
    const completed = taskService.setStatus(ctx, id, 'done');
    spawnNextRecurrence(ctx, task, now);
    emit(ctx.userId, 'task', completed.id, 'completed', {});
    return completed;
  },

  remove(ctx: Ctx, id: string): void {
    taskService.get(ctx, id);
    ctx.db
      .delete(tasks)
      .where(and(eq(tasks.id, id), userScope(tasks, ctx.userId)))
      .run();
    emit(ctx.userId, 'task', id, 'deleted', {});
  },

  addSubtask(ctx: Ctx, parentId: string, input: CreateTaskInput): Task {
    const parent = taskService.get(ctx, parentId);
    if (parent.parentTaskId) {
      throw new ConflictError('Subtasks may only be one level deep');
    }
    return taskService.create(ctx, { ...input, parentTaskId: parentId });
  },

  listSubtasks(ctx: Ctx, parentId: string): Task[] {
    return ctx.db
      .select()
      .from(tasks)
      .where(and(userScope(tasks, ctx.userId), eq(tasks.parentTaskId, parentId)))
      .orderBy(asc(tasks.position), asc(tasks.createdAt))
      .all();
  },

  /** Apply the same patch to many tasks at once; emits per-task events so
   * activity log + SSE live sync stay accurate. All ids must exist and be owned
   * by ctx.userId — a foreign id is treated as missing (all-or-nothing). */
  bulkUpdate(ctx: Ctx, ids: string[], patch: BulkPatch): Task[] {
    if (ids.length === 0) throw new ValidationError('bulkUpdate requires at least one id');

    const existing = ctx.db
      .select()
      .from(tasks)
      .where(and(userScope(tasks, ctx.userId), inArray(tasks.id, ids)))
      .all();
    const byId = new Map(existing.map((t) => [t.id, t]));
    const missing = ids.filter((id) => !byId.has(id)); // foreign or unknown ids both land here
    if (missing.length) throw new NotFoundError('Task(s)', missing.join(', '));

    const setClause: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
    if (patch.status !== undefined) {
      setClause.status = patch.status;
      setClause.completedAt =
        patch.status === 'done' || patch.status === 'cancelled' ? new Date() : null;
    }
    if (patch.priority !== undefined) setClause.priority = patch.priority;
    if (patch.projectId !== undefined) setClause.projectId = patch.projectId;

    ctx.db
      .update(tasks)
      .set(setClause)
      .where(and(userScope(tasks, ctx.userId), inArray(tasks.id, ids)))
      .run();

    if (patch.removeTagIds?.length) {
      for (const id of ids) {
        ctx.db
          .delete(taskTags)
          .where(and(eq(taskTags.taskId, id), inArray(taskTags.tagId, patch.removeTagIds)))
          .run();
      }
    }
    if (patch.addTagIds?.length) {
      for (const id of ids) {
        for (const tagId of patch.addTagIds) {
          ctx.db.insert(taskTags).values({ taskId: id, tagId }).onConflictDoNothing().run();
        }
      }
    }

    const updated = ctx.db
      .select()
      .from(tasks)
      .where(and(userScope(tasks, ctx.userId), inArray(tasks.id, ids)))
      .all();
    for (const t of updated) {
      const before = byId.get(t.id)!;
      if (patch.status !== undefined && before.status !== t.status) {
        emit(ctx.userId, 'task', t.id, 'status_changed', { from: before.status, to: t.status });
      }
      emit(ctx.userId, 'task', t.id, 'updated', { patch });
    }
    return updated;
  },

  /** Hard-delete many tasks at once; emits a `task.deleted` event per id.
   * Non-owned ids are silently skipped (delete is idempotent). */
  bulkDelete(ctx: Ctx, ids: string[]): { deleted: number } {
    if (ids.length === 0) throw new ValidationError('bulkDelete requires at least one id');
    const deleted = ctx.db
      .delete(tasks)
      .where(and(userScope(tasks, ctx.userId), inArray(tasks.id, ids)))
      .returning()
      .all();
    for (const t of deleted) emit(ctx.userId, 'task', t.id, 'deleted', {});
    return { deleted: deleted.length };
  },
};
