import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from './db';
import { userService } from './services/user-service';
import { projectService } from './services/project-service';
import { taskService } from './services/task-service';
import { tagService } from './services/tag-service';
import { timeService } from './services/time-service';
import { reminderService } from './services/reminder-service';
import { savedFilterService } from './services/saved-filter-service';
import { attachmentService } from './services/attachment-service';
import { exportService } from './services/export-service';
import { LOCAL_USER_ID } from './constants';
import { NotFoundError } from './errors';
import type { Ctx } from './context';

describe('cross-tenant isolation (security gate, spec §2)', () => {
  let db: Db;
  let a: Ctx;
  let b: Ctx;
  beforeEach(() => {
    ({ db } = createDb(':memory:'));
    runMigrations(db);
    userService.ensureLocalUser(db);
    userService.create(db, { id: 'user-b', name: 'B' });
    a = { db, userId: LOCAL_USER_ID };
    b = { db, userId: 'user-b' };
  });

  it('lists never leak B rows to A', () => {
    projectService.create(b, { name: 'B' });
    taskService.create(b, { title: 'B' });
    tagService.create(b, { name: 'B' });
    expect(projectService.list(a)).toHaveLength(0);
    expect(taskService.list(a)).toHaveLength(0);
    expect(tagService.list(a)).toHaveLength(0);
    expect(savedFilterService.list(a)).toHaveLength(0);
  });

  it('by-id access to B rows returns NotFound for A', () => {
    const p = projectService.create(b, { name: 'B' });
    const t = taskService.create(b, { title: 'B' });
    for (const call of [
      () => projectService.get(a, p.id),
      () => projectService.remove(a, p.id),
      () => taskService.get(a, t.id),
      () => taskService.remove(a, t.id),
    ]) {
      expect(call).toThrow(NotFoundError);
    }
  });

  it('A cannot cross-reference B entities', () => {
    const bTask = taskService.create(b, { title: 'B' });
    const bTag = tagService.create(b, { name: 'B' });
    const aTask = taskService.create(a, { title: 'A' });
    expect(() => taskService.create(a, { title: 'x', parentTaskId: bTask.id })).toThrow(
      NotFoundError,
    );
    expect(() => tagService.attach(a, aTask.id, bTag.id)).toThrow(NotFoundError);
    expect(() => timeService.startTimer(a, bTask.id)).toThrow(NotFoundError);
    expect(() => reminderService.create(a, { taskId: bTask.id, remindAt: new Date() })).toThrow(
      NotFoundError,
    );
  });

  it('A cannot add an attachment onto a B task', async () => {
    const bTask = taskService.create(b, { title: 'B' });
    await expect(
      attachmentService.add(a, {
        taskId: bTask.id,
        filename: 'x.txt',
        mime: 'text/plain',
        data: new Uint8Array([1]),
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('a forged import (claiming B userId) always re-stamps to the acting user', () => {
    projectService.create(a, { name: 'A only' });
    const snap = exportService.exportSnapshot(a);
    const forged = { ...snap, projects: snap.projects.map((p) => ({ ...p, userId: 'user-b' })) };
    exportService.importSnapshot(a, forged);
    expect(exportService.exportSnapshot(a).projects.every((p) => p.userId === LOCAL_USER_ID)).toBe(
      true,
    );
    // B's own data (none seeded here) remains untouched / inaccessible to A.
    expect(projectService.list(b)).toHaveLength(0);
  });
});
