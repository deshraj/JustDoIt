import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { projectService } from './project-service';
import { NotFoundError } from '../errors';

function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

describe('projectService', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });

  it('creates and reads back a project', () => {
    const p = projectService.create(db, { name: 'Work', color: '#f00' });
    expect(p.id).toMatch(/[0-9a-f-]{36}/);
    expect(p.name).toBe('Work');
    expect(projectService.get(db, p.id).name).toBe('Work');
  });

  it('assigns increasing positions', () => {
    const a = projectService.create(db, { name: 'A' });
    const b = projectService.create(db, { name: 'B' });
    expect(b.position).toBeGreaterThan(a.position);
  });

  it('get throws NotFoundError for a missing id', () => {
    expect(() => projectService.get(db, 'nope')).toThrow(NotFoundError);
  });

  it('lists projects and filters by archived', () => {
    const a = projectService.create(db, { name: 'A' });
    projectService.create(db, { name: 'B' });
    projectService.update(db, a.id, { archived: true });
    expect(projectService.list(db)).toHaveLength(2);
    expect(projectService.list(db, { archived: false })).toHaveLength(1);
    expect(projectService.list(db, { archived: true })).toHaveLength(1);
  });

  it('updates fields and bumps updatedAt', () => {
    const p = projectService.create(db, { name: 'A' });
    const updated = projectService.update(db, p.id, { name: 'A2' });
    expect(updated.name).toBe('A2');
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(p.updatedAt.getTime());
  });

  it('removes a project', () => {
    const p = projectService.create(db, { name: 'A' });
    projectService.remove(db, p.id);
    expect(() => projectService.get(db, p.id)).toThrow(NotFoundError);
    expect(() => projectService.remove(db, p.id)).toThrow(NotFoundError);
  });
});
