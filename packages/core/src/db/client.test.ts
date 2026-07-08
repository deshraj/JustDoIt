import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, runMigrations } from './client';
import { projects, tasks } from './schema';

describe('database bootstrap', () => {
  it('applies migrations and round-trips a project and task', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);

    const [project] = db.insert(projects).values({ name: 'Inbox' }).returning().all();
    expect(project).toBeDefined();
    expect(project!.name).toBe('Inbox');
    expect(project!.id).toMatch(/[0-9a-f-]{36}/);

    const [task] = db
      .insert(tasks)
      .values({ title: 'Write the plan', projectId: project!.id, status: 'todo' })
      .returning()
      .all();
    expect(task!.title).toBe('Write the plan');
    expect(task!.status).toBe('todo');
    expect(task!.createdAt).toBeInstanceOf(Date);

    const found = db.select().from(tasks).where(eq(tasks.id, task!.id)).all();
    expect(found).toHaveLength(1);
  });

  it('defaults task status to todo', () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const [task] = db.insert(tasks).values({ title: 'No status given' }).returning().all();
    expect(task!.status).toBe('todo');
  });
});
