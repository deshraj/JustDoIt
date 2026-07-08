import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { taskService } from './task-service';
import { projectService } from './project-service';
import { tagService } from './tag-service';
import { NotFoundError, ConflictError, ValidationError } from '../errors';

function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

describe('taskService', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });

  it('creates a task with defaults (status todo, no completedAt)', () => {
    const t = taskService.create(db, { title: 'Write plan' });
    expect(t.title).toBe('Write plan');
    expect(t.status).toBe('todo');
    expect(t.completedAt).toBeNull();
  });

  it('rejects a task pointing at a non-existent project', () => {
    expect(() => taskService.create(db, { title: 'x', projectId: 'nope' })).toThrow(NotFoundError);
  });

  it('assigns increasing positions within a scope', () => {
    const a = taskService.create(db, { title: 'a' });
    const b = taskService.create(db, { title: 'b' });
    expect(b.position).toBeGreaterThan(a.position);
  });

  it('setStatus sets completedAt for done and clears it otherwise', () => {
    const t = taskService.create(db, { title: 'x' });
    const done = taskService.setStatus(db, t.id, 'done');
    expect(done.status).toBe('done');
    expect(done.completedAt).toBeInstanceOf(Date);
    const reopened = taskService.setStatus(db, t.id, 'todo');
    expect(reopened.completedAt).toBeNull();
  });

  it('complete() marks a task done', () => {
    const t = taskService.create(db, { title: 'x' });
    expect(taskService.complete(db, t.id).status).toBe('done');
  });

  it('cancelled also sets completedAt', () => {
    const t = taskService.create(db, { title: 'x' });
    expect(taskService.setStatus(db, t.id, 'cancelled').completedAt).toBeInstanceOf(Date);
  });

  it('adds a subtask but forbids nesting beyond one level', () => {
    const parent = taskService.create(db, { title: 'parent' });
    const child = taskService.addSubtask(db, parent.id, { title: 'child' });
    expect(child.parentTaskId).toBe(parent.id);
    expect(taskService.listSubtasks(db, parent.id).map((t) => t.title)).toEqual(['child']);
    expect(() => taskService.addSubtask(db, child.id, { title: 'grandchild' })).toThrow(
      ConflictError,
    );
  });

  it('filters by status, project, priority, archived, parentTaskId', () => {
    const proj = projectService.create(db, { name: 'P' });
    taskService.create(db, { title: 'a', projectId: proj.id, priority: 'p1' });
    const b = taskService.create(db, { title: 'b', status: 'in_progress' });
    taskService.update(db, b.id, { archived: true });

    expect(taskService.list(db, { projectId: proj.id })).toHaveLength(1);
    expect(taskService.list(db, { projectId: null })).toHaveLength(1); // Inbox = b
    expect(taskService.list(db, { priority: 'p1' })).toHaveLength(1);
    expect(taskService.list(db, { status: 'in_progress' })).toHaveLength(1);
    expect(taskService.list(db, { archived: true })).toHaveLength(1);
    expect(taskService.list(db, { parentTaskId: null })).toHaveLength(2); // both top-level
  });

  it('filters by tagId and free-text search', () => {
    const a = taskService.create(db, { title: 'buy milk', description: 'at the store' });
    taskService.create(db, { title: 'call bank' });
    const tag = tagService.create(db, { name: 'errands' });
    tagService.attach(db, a.id, tag.id);

    expect(taskService.list(db, { tagId: tag.id }).map((t) => t.title)).toEqual(['buy milk']);
    expect(taskService.list(db, { search: 'milk' }).map((t) => t.title)).toEqual(['buy milk']);
    expect(taskService.list(db, { search: 'store' }).map((t) => t.title)).toEqual(['buy milk']);
    expect(taskService.list(db, { search: 'zzz' })).toHaveLength(0);
  });

  it('filters by an inclusive dueFrom/dueTo range', () => {
    const dueFrom = new Date('2026-03-01T00:00:00Z');
    const dueTo = new Date('2026-03-31T23:59:59Z');
    taskService.create(db, { title: 'before range', dueAt: new Date('2026-02-15T00:00:00Z') });
    taskService.create(db, { title: 'on dueFrom boundary', dueAt: dueFrom });
    taskService.create(db, { title: 'inside range', dueAt: new Date('2026-03-15T00:00:00Z') });
    taskService.create(db, { title: 'on dueTo boundary', dueAt: dueTo });
    taskService.create(db, { title: 'after range', dueAt: new Date('2026-04-15T00:00:00Z') });
    taskService.create(db, { title: 'no due date' });

    expect(taskService.list(db, { dueFrom, dueTo }).map((t) => t.title)).toEqual([
      'on dueFrom boundary',
      'inside range',
      'on dueTo boundary',
    ]);
  });

  it('removes a task and cascades its subtasks', () => {
    const parent = taskService.create(db, { title: 'parent' });
    taskService.addSubtask(db, parent.id, { title: 'child' });
    taskService.remove(db, parent.id);
    expect(() => taskService.get(db, parent.id)).toThrow(NotFoundError);
    expect(taskService.list(db)).toHaveLength(0);
  });

  it('rejects creating a task whose startAt is after dueAt', () => {
    expect(() =>
      taskService.create(db, {
        title: 'bad window',
        startAt: new Date('2026-02-02T00:00:00Z'),
        dueAt: new Date('2026-02-01T00:00:00Z'),
      }),
    ).toThrow(ValidationError);
  });

  it('rejects creating a task with an invalid recurrence', () => {
    expect(() => taskService.create(db, { title: 'bad rule', recurrence: 'FREQ=NOPE' })).toThrow(
      ValidationError,
    );
  });

  it('accepts a valid recurrence', () => {
    const task = taskService.create(db, { title: 'daily standup', recurrence: 'FREQ=DAILY' });
    expect(task.recurrence).toBe('FREQ=DAILY');
  });

  it('rejects updating a task into an invalid window', () => {
    const t = taskService.create(db, { title: 'x', dueAt: new Date('2026-02-01T00:00:00Z') });
    expect(() =>
      taskService.update(db, t.id, { startAt: new Date('2026-02-02T00:00:00Z') }),
    ).toThrow(ValidationError);
  });

  it('rejects updating a task with an invalid recurrence', () => {
    const t = taskService.create(db, { title: 'x' });
    expect(() => taskService.update(db, t.id, { recurrence: 'FREQ=NOPE' })).toThrow(
      ValidationError,
    );
  });

  it('spawns the next occurrence when completing a recurring task', () => {
    const now = new Date('2026-03-02T10:00:00Z');
    const task = taskService.create(db, {
      title: 'water plants',
      recurrence: 'FREQ=WEEKLY;BYDAY=MO',
      dueAt: new Date('2026-03-02T09:00:00Z'), // a Monday
    });
    taskService.complete(db, task.id, now);

    const open = taskService.list(db, { status: 'todo' });
    const spawned = open.find((t) => t.title === 'water plants');
    expect(spawned).toBeDefined();
    expect(spawned!.id).not.toBe(task.id);
    expect(spawned!.dueAt?.toISOString()).toBe('2026-03-09T09:00:00.000Z');
    expect(spawned!.recurrence).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(spawned!.completedAt).toBeNull();
  });

  it('does not spawn for a non-recurring task', () => {
    const now = new Date('2026-03-02T10:00:00Z');
    const task = taskService.create(db, {
      title: 'one-off',
      dueAt: new Date('2026-03-02T09:00:00Z'),
    });
    taskService.complete(db, task.id, now);
    const open = taskService.list(db, { status: 'todo' });
    expect(open.find((t) => t.title === 'one-off')).toBeUndefined();
  });
});
