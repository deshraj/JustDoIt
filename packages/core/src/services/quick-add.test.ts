import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { parseQuickAdd, quickAddService } from './quick-add';
import { projectService } from './project-service';
import { tagService } from './tag-service';
import { LOCAL_USER_ID } from '../constants';

// Wed 2026-07-08 10:00 local
const NOW = new Date(2026, 6, 8, 10, 0, 0, 0);

describe('parseQuickAdd', () => {
  it('parses a full string: title, tomorrow 5pm, tag, priority', () => {
    const r = parseQuickAdd('buy milk tomorrow 5pm #errands p1', NOW);
    expect(r.title).toBe('buy milk');
    expect(r.tags).toEqual(['errands']);
    expect(r.priority).toBe('p1');
    expect(r.dueAt).toEqual(new Date(2026, 6, 9, 17, 0, 0, 0));
  });

  it('parses a project token and multiple tags', () => {
    const r = parseQuickAdd('draft spec @work #writing #focus', NOW);
    expect(r.title).toBe('draft spec');
    expect(r.projectName).toBe('work');
    expect(r.tags).toEqual(['writing', 'focus']);
    expect(r.dueAt).toBeUndefined();
  });

  it('today defaults to 09:00 when no time is given', () => {
    const r = parseQuickAdd('standup today', NOW);
    expect(r.dueAt).toEqual(new Date(2026, 6, 8, 9, 0, 0, 0));
  });

  it('a bare time means today at that time', () => {
    const r = parseQuickAdd('lunch 12:30', NOW);
    expect(r.dueAt).toEqual(new Date(2026, 6, 8, 12, 30, 0, 0));
  });

  it('a weekday resolves to the next occurrence', () => {
    const r = parseQuickAdd('gym monday', NOW); // NOW is Wed -> next Mon = 2026-07-13
    expect(r.dueAt).toEqual(new Date(2026, 6, 13, 9, 0, 0, 0));
  });

  it('does not treat a bare integer as a time', () => {
    const r = parseQuickAdd('read 5 pages', NOW);
    expect(r.title).toBe('read 5 pages');
    expect(r.dueAt).toBeUndefined();
  });
});

describe('quickAddService.create', () => {
  let db: Db;
  beforeEach(() => {
    const created = createDb(':memory:');
    runMigrations(created.db);
    db = created.db;
  });

  it('creates the task, project, and tags from one string', () => {
    const task = quickAddService.create(db, 'buy milk tomorrow 5pm @errands-list #errands p1', NOW);
    expect(task.title).toBe('buy milk');
    expect(task.priority).toBe('p1');
    expect(task.dueAt).toEqual(new Date(2026, 6, 9, 17, 0, 0, 0));
    expect(projectService.get({ db, userId: LOCAL_USER_ID }, task.projectId!).name).toBe(
      'errands-list',
    );
    expect(tagService.listForTask({ db, userId: LOCAL_USER_ID }, task.id).map((t) => t.name)).toEqual([
      'errands',
    ]);
  });

  it('reuses an existing project and tag by name', () => {
    const proj = projectService.create({ db, userId: LOCAL_USER_ID }, { name: 'work' });
    const tag = tagService.create({ db, userId: LOCAL_USER_ID }, { name: 'writing' });
    const task = quickAddService.create(db, 'draft @work #writing', NOW);
    expect(task.projectId).toBe(proj.id);
    expect(tagService.listForTask({ db, userId: LOCAL_USER_ID }, task.id)[0]!.id).toBe(tag.id);
  });
});
