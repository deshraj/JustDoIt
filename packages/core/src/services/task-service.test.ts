import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { taskService } from './task-service';
import { projectService } from './project-service';
import { tagService } from './tag-service';
import { NotFoundError, ConflictError, ValidationError } from '../errors';
import { LOCAL_USER_ID } from '../constants';
import { userService } from './user-service';
import type { Ctx } from '../context';

function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

function ctxFor(db: Db, userId: string): Ctx {
  return { db, userId };
}

describe('taskService', () => {
  let db: Db;
  let ctx: Ctx;
  beforeEach(() => {
    db = freshDb();
    ctx = ctxFor(db, LOCAL_USER_ID);
  });

  it('creates a task with defaults (status todo, no completedAt)', () => {
    const t = taskService.create(ctx, { title: 'Write plan' });
    expect(t.title).toBe('Write plan');
    expect(t.status).toBe('todo');
    expect(t.completedAt).toBeNull();
  });

  it('rejects a task pointing at a non-existent project', () => {
    expect(() => taskService.create(ctx, { title: 'x', projectId: 'nope' })).toThrow(NotFoundError);
  });

  it('assigns increasing positions within a scope', () => {
    const a = taskService.create(ctx, { title: 'a' });
    const b = taskService.create(ctx, { title: 'b' });
    expect(b.position).toBeGreaterThan(a.position);
  });

  it('setStatus sets completedAt for done and clears it otherwise', () => {
    const t = taskService.create(ctx, { title: 'x' });
    const done = taskService.setStatus(ctx, t.id, 'done');
    expect(done.status).toBe('done');
    expect(done.completedAt).toBeInstanceOf(Date);
    const reopened = taskService.setStatus(ctx, t.id, 'todo');
    expect(reopened.completedAt).toBeNull();
  });

  it('complete() marks a task done', () => {
    const t = taskService.create(ctx, { title: 'x' });
    expect(taskService.complete(ctx, t.id).status).toBe('done');
  });

  it('cancelled also sets completedAt', () => {
    const t = taskService.create(ctx, { title: 'x' });
    expect(taskService.setStatus(ctx, t.id, 'cancelled').completedAt).toBeInstanceOf(Date);
  });

  it('adds a subtask but forbids nesting beyond one level', () => {
    const parent = taskService.create(ctx, { title: 'parent' });
    const child = taskService.addSubtask(ctx, parent.id, { title: 'child' });
    expect(child.parentTaskId).toBe(parent.id);
    expect(taskService.listSubtasks(ctx, parent.id).map((t) => t.title)).toEqual(['child']);
    expect(() => taskService.addSubtask(ctx, child.id, { title: 'grandchild' })).toThrow(
      ConflictError,
    );
  });

  it('filters by status, project, priority, archived, parentTaskId', () => {
    const proj = projectService.create(ctx, { name: 'P' });
    taskService.create(ctx, { title: 'a', projectId: proj.id, priority: 'p1' });
    const b = taskService.create(ctx, { title: 'b', status: 'in_progress' });
    taskService.update(ctx, b.id, { archived: true });

    expect(taskService.list(ctx, { projectId: proj.id })).toHaveLength(1);
    expect(taskService.list(ctx, { projectId: null })).toHaveLength(1); // Inbox = b
    expect(taskService.list(ctx, { priority: 'p1' })).toHaveLength(1);
    expect(taskService.list(ctx, { status: 'in_progress' })).toHaveLength(1);
    expect(taskService.list(ctx, { archived: true })).toHaveLength(1);
    expect(taskService.list(ctx, { parentTaskId: null })).toHaveLength(2); // both top-level
  });

  it('filters by tagId and free-text search', () => {
    const a = taskService.create(ctx, { title: 'buy milk', description: 'at the store' });
    taskService.create(ctx, { title: 'call bank' });
    const tag = tagService.create(ctx, { name: 'errands' });
    tagService.attach(ctx, a.id, tag.id);

    expect(taskService.list(ctx, { tagId: tag.id }).map((t) => t.title)).toEqual(['buy milk']);
    expect(taskService.list(ctx, { search: 'milk' }).map((t) => t.title)).toEqual(['buy milk']);
    expect(taskService.list(ctx, { search: 'store' }).map((t) => t.title)).toEqual(['buy milk']);
    expect(taskService.list(ctx, { search: 'zzz' })).toHaveLength(0);
  });

  it('filters by an inclusive dueFrom/dueTo range', () => {
    const dueFrom = new Date('2026-03-01T00:00:00Z');
    const dueTo = new Date('2026-03-31T23:59:59Z');
    taskService.create(ctx, { title: 'before range', dueAt: new Date('2026-02-15T00:00:00Z') });
    taskService.create(ctx, { title: 'on dueFrom boundary', dueAt: dueFrom });
    taskService.create(ctx, { title: 'inside range', dueAt: new Date('2026-03-15T00:00:00Z') });
    taskService.create(ctx, { title: 'on dueTo boundary', dueAt: dueTo });
    taskService.create(ctx, { title: 'after range', dueAt: new Date('2026-04-15T00:00:00Z') });
    taskService.create(ctx, { title: 'no due date' });

    expect(taskService.list(ctx, { dueFrom, dueTo }).map((t) => t.title)).toEqual([
      'on dueFrom boundary',
      'inside range',
      'on dueTo boundary',
    ]);
  });

  it('removes a task and cascades its subtasks', () => {
    const parent = taskService.create(ctx, { title: 'parent' });
    taskService.addSubtask(ctx, parent.id, { title: 'child' });
    taskService.remove(ctx, parent.id);
    expect(() => taskService.get(ctx, parent.id)).toThrow(NotFoundError);
    expect(taskService.list(ctx)).toHaveLength(0);
  });

  it('rejects creating a task whose startAt is after dueAt', () => {
    expect(() =>
      taskService.create(ctx, {
        title: 'bad window',
        startAt: new Date('2026-02-02T00:00:00Z'),
        dueAt: new Date('2026-02-01T00:00:00Z'),
      }),
    ).toThrow(ValidationError);
  });

  it('rejects creating a task with an invalid recurrence', () => {
    expect(() => taskService.create(ctx, { title: 'bad rule', recurrence: 'FREQ=NOPE' })).toThrow(
      ValidationError,
    );
  });

  it('accepts a valid recurrence', () => {
    const task = taskService.create(ctx, { title: 'daily standup', recurrence: 'FREQ=DAILY' });
    expect(task.recurrence).toBe('FREQ=DAILY');
  });

  it('rejects updating a task into an invalid window', () => {
    const t = taskService.create(ctx, { title: 'x', dueAt: new Date('2026-02-01T00:00:00Z') });
    expect(() =>
      taskService.update(ctx, t.id, { startAt: new Date('2026-02-02T00:00:00Z') }),
    ).toThrow(ValidationError);
  });

  it('rejects updating a task with an invalid recurrence', () => {
    const t = taskService.create(ctx, { title: 'x' });
    expect(() => taskService.update(ctx, t.id, { recurrence: 'FREQ=NOPE' })).toThrow(
      ValidationError,
    );
  });

  it('spawns the next occurrence when completing a recurring task', () => {
    const now = new Date('2026-03-02T10:00:00Z');
    const task = taskService.create(ctx, {
      title: 'water plants',
      recurrence: 'FREQ=WEEKLY;BYDAY=MO',
      dueAt: new Date('2026-03-02T09:00:00Z'), // a Monday
    });
    taskService.complete(ctx, task.id, now);

    const open = taskService.list(ctx, { status: 'todo' });
    const spawned = open.find((t) => t.title === 'water plants');
    expect(spawned).toBeDefined();
    expect(spawned!.id).not.toBe(task.id);
    expect(spawned!.dueAt?.toISOString()).toBe('2026-03-09T09:00:00.000Z');
    expect(spawned!.recurrence).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(spawned!.completedAt).toBeNull();
  });

  it('completing a recurring task twice spawns exactly one next occurrence', () => {
    const now = new Date('2026-03-02T10:00:00Z');
    const task = taskService.create(ctx, {
      title: 'water plants',
      recurrence: 'FREQ=WEEKLY;BYDAY=MO',
      dueAt: new Date('2026-03-02T09:00:00Z'), // a Monday
    });
    taskService.complete(ctx, task.id, now);
    // Second complete on the already-done task must be a no-op for spawning.
    taskService.complete(ctx, task.id, now);

    const spawned = taskService
      .list(ctx, { status: 'todo' })
      .filter((t) => t.title === 'water plants' && t.id !== task.id);
    expect(spawned).toHaveLength(1);
  });

  it('spawned recurring occurrence carries the source task tags and a fresh position', () => {
    const now = new Date('2026-03-02T10:00:00Z');
    const tag = tagService.create(ctx, { name: 'garden' });
    const task = taskService.create(ctx, {
      title: 'water plants',
      recurrence: 'FREQ=WEEKLY;BYDAY=MO',
      dueAt: new Date('2026-03-02T09:00:00Z'),
    });
    tagService.attach(ctx, task.id, tag.id);
    taskService.complete(ctx, task.id, now);

    const spawned = taskService
      .list(ctx, { status: 'todo' })
      .find((t) => t.title === 'water plants' && t.id !== task.id);
    expect(spawned).toBeDefined();
    // Tags copied onto the new occurrence.
    expect(taskService.list(ctx, { tagId: tag.id }).map((t) => t.id)).toContain(spawned!.id);
    // Fresh position, not a collision with the completed source task.
    expect(spawned!.position).not.toBe(task.position);
  });

  it('does not spawn for a non-recurring task', () => {
    const now = new Date('2026-03-02T10:00:00Z');
    const task = taskService.create(ctx, {
      title: 'one-off',
      dueAt: new Date('2026-03-02T09:00:00Z'),
    });
    taskService.complete(ctx, task.id, now);
    const open = taskService.list(ctx, { status: 'todo' });
    expect(open.find((t) => t.title === 'one-off')).toBeUndefined();
  });

  describe('cross-tenant isolation', () => {
    let a: Ctx;
    let b: Ctx;
    beforeEach(() => {
      userService.create(db, { id: 'user-b', name: 'B' });
      a = ctxFor(db, LOCAL_USER_ID);
      b = ctxFor(db, 'user-b');
    });

    it('A cannot get/update/delete B task, nor reparent under B', () => {
      const bTask = taskService.create(b, { title: 'B task' });
      expect(() => taskService.get(a, bTask.id)).toThrow(NotFoundError);
      expect(() => taskService.setStatus(a, bTask.id, 'done')).toThrow(NotFoundError);
      expect(() => taskService.remove(a, bTask.id)).toThrow(NotFoundError);
      // reparent: A creates a task whose parent is B's task → 404 (parent not owned).
      expect(() => taskService.create(a, { title: 'child', parentTaskId: bTask.id })).toThrow(
        NotFoundError,
      );
      // A cannot attach B's project.
      const bProj = projectService.create(b, { name: 'B proj' });
      expect(() => taskService.create(a, { title: 'x', projectId: bProj.id })).toThrow(
        NotFoundError,
      );
    });

    it('list never leaks B tasks to A', () => {
      taskService.create(b, { title: 'B task' });
      taskService.create(a, { title: 'A task' });
      expect(taskService.list(a).map((t) => t.title)).toEqual(['A task']);
    });

    it('listOverdue/listDueToday/listUpcoming exclude B tasks', async () => {
      const { listOverdue, listDueToday, listUpcoming } = await import('./schedule-service');
      const now = new Date(2026, 0, 15, 12, 0, 0);
      taskService.create(b, { title: 'B overdue', dueAt: new Date(2026, 0, 14, 9, 0, 0) });
      taskService.create(b, { title: 'B today', dueAt: new Date(2026, 0, 15, 9, 0, 0) });
      taskService.create(b, { title: 'B upcoming', dueAt: new Date(2026, 0, 17, 9, 0, 0) });
      expect(listOverdue(a, now)).toHaveLength(0);
      expect(listDueToday(a, now)).toHaveLength(0);
      expect(listUpcoming(a, now, 7)).toHaveLength(0);
    });
  });
});
