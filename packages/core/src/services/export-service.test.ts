import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { exportService } from './export-service';
import { taskService } from './task-service';
import { projectService } from './project-service';
import { tagService } from './tag-service';
import { ValidationError } from '../errors';

function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

function seed(db: Db): void {
  const proj = projectService.create(db, { name: 'Work' });
  const parent = taskService.create(db, { title: 'parent', projectId: proj.id });
  taskService.addSubtask(db, parent.id, { title: 'child' });
  const tag = tagService.create(db, { name: 'focus' });
  tagService.attach(db, parent.id, tag.id);
}

describe('exportService', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });

  it('exports a snapshot with all rows', () => {
    seed(db);
    const snap = exportService.exportSnapshot(db);
    expect(snap.version).toBe(1);
    expect(snap.projects).toHaveLength(1);
    expect(snap.tasks).toHaveLength(2);
    expect(snap.tags).toHaveLength(1);
    expect(snap.taskTags).toHaveLength(1);
    expect(typeof snap.exportedAt).toBe('string');
  });

  it('round-trips: export from one db, import into another', () => {
    seed(db);
    const snap = exportService.exportSnapshot(db);

    const target = freshDb();
    const result = exportService.importSnapshot(target, snap);
    expect(result.counts.tasks).toBe(2);

    const roundTripped = exportService.exportSnapshot(target);
    expect(roundTripped.projects).toHaveLength(1);
    expect(roundTripped.tasks).toHaveLength(2);
    expect(roundTripped.taskTags).toHaveLength(1);
    // Dates survive as Dates after import.
    expect(taskService.list(target)[0]!.createdAt).toBeInstanceOf(Date);
  });

  it('import replaces existing data', () => {
    seed(db);
    const snap = exportService.exportSnapshot(db);
    const target = freshDb();
    projectService.create(target, { name: 'stale' });
    exportService.importSnapshot(target, snap);
    expect(projectService.list(target).map((p) => p.name)).toEqual(['Work']);
  });

  it('rejects a malformed snapshot', () => {
    expect(() => exportService.importSnapshot(db, {} as never)).toThrow(ValidationError);
  });
});
