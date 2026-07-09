import { eq, asc } from 'drizzle-orm';
import type { Db } from '../db';
import { projects, type Project } from '../db/schema';
import { NotFoundError } from '../errors';
import {
  createProjectSchema,
  updateProjectSchema,
  type CreateProjectInput,
  type UpdateProjectInput,
} from '../schemas';
import { emit } from '../events/emit';
import { LOCAL_USER_ID } from '../constants';

function nextPosition(db: Db): number {
  const rows = db.select({ position: projects.position }).from(projects).all();
  return rows.reduce((max, r) => Math.max(max, r.position), 0) + 1;
}

export const projectService = {
  create(db: Db, input: CreateProjectInput): Project {
    const parsed = createProjectSchema.parse(input);
    const [row] = db
      .insert(projects)
      .values({ ...parsed, position: nextPosition(db) })
      .returning()
      .all();
    emit(LOCAL_USER_ID, 'project', row!.id, 'created', { name: row!.name });
    return row!;
  },

  get(db: Db, id: string): Project {
    const row = db.select().from(projects).where(eq(projects.id, id)).get();
    if (!row) throw new NotFoundError('Project', id);
    return row;
  },

  list(db: Db, opts: { archived?: boolean } = {}): Project[] {
    const where = opts.archived === undefined ? undefined : eq(projects.archived, opts.archived);
    return db
      .select()
      .from(projects)
      .where(where)
      .orderBy(asc(projects.position), asc(projects.createdAt))
      .all();
  },

  update(db: Db, id: string, patch: UpdateProjectInput): Project {
    const parsed = updateProjectSchema.parse(patch);
    projectService.get(db, id);
    const [row] = db
      .update(projects)
      .set({ ...parsed, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning()
      .all();
    emit(LOCAL_USER_ID, 'project', row!.id, 'updated', { patch });
    return row!;
  },

  remove(db: Db, id: string): void {
    projectService.get(db, id);
    db.delete(projects).where(eq(projects.id, id)).run();
    emit(LOCAL_USER_ID, 'project', id, 'deleted', {});
  },
};
