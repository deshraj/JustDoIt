import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { projectService } from './project-service';
import { NotFoundError } from '../errors';
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

describe('projectService', () => {
  let db: Db;
  let ctx: Ctx;
  beforeEach(() => {
    db = freshDb();
    ctx = ctxFor(db, LOCAL_USER_ID);
  });

  it('creates and reads back a project', () => {
    const p = projectService.create(ctx, { name: 'Work', color: '#f00' });
    expect(p.id).toMatch(/[0-9a-f-]{36}/);
    expect(p.name).toBe('Work');
    expect(projectService.get(ctx, p.id).name).toBe('Work');
  });

  it('assigns increasing positions', () => {
    const a = projectService.create(ctx, { name: 'A' });
    const b = projectService.create(ctx, { name: 'B' });
    expect(b.position).toBeGreaterThan(a.position);
  });

  it('get throws NotFoundError for a missing id', () => {
    expect(() => projectService.get(ctx, 'nope')).toThrow(NotFoundError);
  });

  it('lists projects and filters by archived', () => {
    const a = projectService.create(ctx, { name: 'A' });
    projectService.create(ctx, { name: 'B' });
    projectService.update(ctx, a.id, { archived: true });
    expect(projectService.list(ctx)).toHaveLength(2);
    expect(projectService.list(ctx, { archived: false })).toHaveLength(1);
    expect(projectService.list(ctx, { archived: true })).toHaveLength(1);
  });

  it('updates fields and bumps updatedAt', () => {
    const p = projectService.create(ctx, { name: 'A' });
    const updated = projectService.update(ctx, p.id, { name: 'A2' });
    expect(updated.name).toBe('A2');
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(p.updatedAt.getTime());
  });

  it('removes a project', () => {
    const p = projectService.create(ctx, { name: 'A' });
    projectService.remove(ctx, p.id);
    expect(() => projectService.get(ctx, p.id)).toThrow(NotFoundError);
    expect(() => projectService.remove(ctx, p.id)).toThrow(NotFoundError);
  });

  describe('cross-tenant isolation', () => {
    let a: Ctx;
    let b: Ctx;
    beforeEach(() => {
      userService.create(db, { id: 'user-b', name: 'B' });
      a = ctxFor(db, LOCAL_USER_ID);
      b = ctxFor(db, 'user-b');
    });

    it('A cannot see, get, update, or delete B rows', () => {
      const bProj = projectService.create(b, { name: 'B secret' });

      expect(projectService.list(a).map((p) => p.id)).not.toContain(bProj.id);
      expect(() => projectService.get(a, bProj.id)).toThrow(NotFoundError);
      expect(() => projectService.update(a, bProj.id, { name: 'hijack' })).toThrow(NotFoundError);
      expect(() => projectService.remove(a, bProj.id)).toThrow(NotFoundError);
      // B still owns an untouched row.
      expect(projectService.get(b, bProj.id).name).toBe('B secret');
    });

    it('positions are computed per user', () => {
      projectService.create(b, { name: 'B1' });
      projectService.create(b, { name: 'B2' });
      const a1 = projectService.create(a, { name: 'A1' });
      expect(a1.position).toBe(1);
    });
  });
});
