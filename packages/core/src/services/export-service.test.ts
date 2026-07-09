import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { exportService } from './export-service';
import { taskService } from './task-service';
import { projectService } from './project-service';
import { tagService } from './tag-service';
import { userService } from './user-service';
import { ValidationError } from '../errors';
import { LOCAL_USER_ID } from '../constants';
import type { Ctx } from '../context';

function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

function ctxFor(db: Db, userId: string): Ctx {
  return { db, userId };
}

function seed(ctx: Ctx): void {
  const proj = projectService.create(ctx, { name: 'Work' });
  const parent = taskService.create(ctx, { title: 'parent', projectId: proj.id });
  taskService.addSubtask(ctx, parent.id, { title: 'child' });
  const tag = tagService.create(ctx, { name: 'focus' });
  tagService.attach(ctx, parent.id, tag.id);
}

describe('exportService', () => {
  let db: Db;
  let ctx: Ctx;
  beforeEach(() => {
    db = freshDb();
    ctx = ctxFor(db, LOCAL_USER_ID);
  });

  it('exports a snapshot with all rows', () => {
    seed(ctx);
    const snap = exportService.exportSnapshot(ctx);
    expect(snap.version).toBe(1);
    expect(snap.projects).toHaveLength(1);
    expect(snap.tasks).toHaveLength(2);
    expect(snap.tags).toHaveLength(1);
    expect(snap.taskTags).toHaveLength(1);
    expect(typeof snap.exportedAt).toBe('string');
  });

  it('round-trips: export from one db, import into another', () => {
    seed(ctx);
    const snap = exportService.exportSnapshot(ctx);

    const target = freshDb();
    const targetCtx = ctxFor(target, LOCAL_USER_ID);
    const result = exportService.importSnapshot(targetCtx, snap);
    expect(result.counts.tasks).toBe(2);

    const roundTripped = exportService.exportSnapshot(targetCtx);
    expect(roundTripped.projects).toHaveLength(1);
    expect(roundTripped.tasks).toHaveLength(2);
    expect(roundTripped.taskTags).toHaveLength(1);
    // Dates survive as Dates after import.
    expect(taskService.list(targetCtx)[0]!.createdAt).toBeInstanceOf(Date);
  });

  it('import replaces existing data', () => {
    seed(ctx);
    const snap = exportService.exportSnapshot(ctx);
    const target = freshDb();
    const targetCtx = ctxFor(target, LOCAL_USER_ID);
    projectService.create(targetCtx, { name: 'stale' });
    exportService.importSnapshot(targetCtx, snap);
    expect(projectService.list(targetCtx).map((p) => p.name)).toEqual(['Work']);
  });

  it('rejects a malformed snapshot', () => {
    expect(() => exportService.importSnapshot(ctx, {} as never)).toThrow(ValidationError);
  });

  it('rejects a snapshot with an unsupported version', () => {
    seed(ctx);
    const snap = exportService.exportSnapshot(ctx);
    const target = freshDb();
    const targetCtx = ctxFor(target, LOCAL_USER_ID);
    expect(() =>
      exportService.importSnapshot(targetCtx, { ...snap, version: 2 } as never),
    ).toThrow(ValidationError);
  });

  describe('cross-tenant isolation', () => {
    let a: Ctx;
    let b: Ctx;
    beforeEach(() => {
      userService.create(db, { id: 'user-b', name: 'B' });
      a = ctxFor(db, LOCAL_USER_ID);
      b = ctxFor(db, 'user-b');
    });

    it('export returns only the acting user data', () => {
      projectService.create(a, { name: 'A only' });
      projectService.create(b, { name: 'B only' });
      const snap = exportService.exportSnapshot(a);
      expect(snap.projects.map((p) => p.name)).toEqual(['A only']);
    });

    it('import re-stamps to the acting user and never writes into B', () => {
      const bProj = projectService.create(b, { name: 'B before' });
      projectService.create(a, { name: 'A project' });
      const snap = exportService.exportSnapshot(a); // A's own snapshot
      // Even a hand-forged snapshot claiming userId:'user-b' imports as A:
      const forged = { ...snap, projects: snap.projects.map((p) => ({ ...p, userId: 'user-b' })) };
      exportService.importSnapshot(a, forged);
      expect(projectService.get(b, bProj.id).name).toBe('B before'); // B untouched
      expect(
        exportService.exportSnapshot(a).projects.every((p) => p.userId === LOCAL_USER_ID),
      ).toBe(true);
    });

    it('importSnapshot as A does not delete B rows', () => {
      const bProj = projectService.create(b, { name: 'B project' });
      const aSnap = exportService.exportSnapshot(a);
      exportService.importSnapshot(a, aSnap);
      expect(projectService.get(b, bProj.id).name).toBe('B project');
    });
  });
});
