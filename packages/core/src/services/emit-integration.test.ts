import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations } from '../db/client';
import { events, type DomainEvent } from '../events/bus';
import { taskService } from './task-service';
import { projectService } from './project-service';
import { LOCAL_USER_ID } from '../constants';

describe('service event emission', () => {
  beforeEach(() => events.reset());

  it('emits task.created then task.status_changed with from/to', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const seen: DomainEvent[] = [];
    events.subscribe((e) => seen.push(e));

    const ctx = { db, userId: LOCAL_USER_ID };
    const task = taskService.create(ctx, { title: 'Ship it' });
    taskService.setStatus(ctx, task.id, 'in_progress');

    expect(seen.map((e) => e.type)).toEqual(['task.created', 'task.status_changed']);
    expect(seen[0]).toMatchObject({ entityType: 'task', entityId: task.id });
    expect(seen[1]!.at).toBeGreaterThanOrEqual(seen[0]!.at);
    expect(seen[1]!.payload).toMatchObject({ from: 'todo', to: 'in_progress' });
  });

  it('emits project.created', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const seen: DomainEvent[] = [];
    events.subscribe((e) => seen.push(e));
    const project = projectService.create({ db, userId: LOCAL_USER_ID }, { name: 'Work' });
    expect(seen[0]).toMatchObject({ type: 'project.created', entityId: project.id });
  });
});
