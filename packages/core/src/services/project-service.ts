import { and, asc, eq } from 'drizzle-orm';
import { projects, type Project } from '../db/schema';
import { NotFoundError } from '../errors';
import { userScope } from '../scope';
import type { Ctx } from '../context';
import {
  createProjectSchema,
  updateProjectSchema,
  type CreateProjectInput,
  type UpdateProjectInput,
} from '../schemas';
import { emit } from '../events/emit';

function nextPosition(ctx: Ctx): number {
  const rows = ctx.db
    .select({ position: projects.position })
    .from(projects)
    .where(userScope(projects, ctx.userId))
    .all();
  return rows.reduce((max, r) => Math.max(max, r.position), 0) + 1;
}

export const projectService = {
  create(ctx: Ctx, input: CreateProjectInput): Project {
    const parsed = createProjectSchema.parse(input);
    const [row] = ctx.db
      .insert(projects)
      .values({ ...parsed, userId: ctx.userId, position: nextPosition(ctx) })
      .returning()
      .all();
    emit(ctx.userId, 'project', row!.id, 'created', { name: row!.name });
    return row!;
  },

  get(ctx: Ctx, id: string): Project {
    const row = ctx.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), userScope(projects, ctx.userId)))
      .get();
    if (!row) throw new NotFoundError('Project', id);
    return row;
  },

  list(ctx: Ctx, opts: { archived?: boolean } = {}): Project[] {
    const conds = [userScope(projects, ctx.userId)];
    if (opts.archived !== undefined) conds.push(eq(projects.archived, opts.archived));
    return ctx.db
      .select()
      .from(projects)
      .where(and(...conds))
      .orderBy(asc(projects.position), asc(projects.createdAt))
      .all();
  },

  update(ctx: Ctx, id: string, patch: UpdateProjectInput): Project {
    const parsed = updateProjectSchema.parse(patch);
    projectService.get(ctx, id); // 404s a foreign id
    const [row] = ctx.db
      .update(projects)
      .set({ ...parsed, updatedAt: new Date() })
      .where(and(eq(projects.id, id), userScope(projects, ctx.userId)))
      .returning()
      .all();
    emit(ctx.userId, 'project', row!.id, 'updated', { patch });
    return row!;
  },

  remove(ctx: Ctx, id: string): void {
    projectService.get(ctx, id); // 404s a foreign id
    ctx.db
      .delete(projects)
      .where(and(eq(projects.id, id), userScope(projects, ctx.userId)))
      .run();
    emit(ctx.userId, 'project', id, 'deleted', {});
  },
};
