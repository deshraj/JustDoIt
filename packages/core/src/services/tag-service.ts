import { and, asc, eq } from 'drizzle-orm';
import { tags, taskTags, tasks, type Tag } from '../db/schema';
import { NotFoundError, ConflictError } from '../errors';
import { userScope } from '../scope';
import type { Ctx } from '../context';
import {
  createTagSchema,
  updateTagSchema,
  type CreateTagInput,
  type UpdateTagInput,
} from '../schemas';

function requireOwnedTask(ctx: Ctx, taskId: string): void {
  const row = ctx.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), userScope(tasks, ctx.userId)))
    .get();
  if (!row) throw new NotFoundError('Task', taskId);
}

export const tagService = {
  create(ctx: Ctx, input: CreateTagInput): Tag {
    const parsed = createTagSchema.parse(input);
    const existing = ctx.db
      .select()
      .from(tags)
      .where(and(userScope(tags, ctx.userId), eq(tags.name, parsed.name)))
      .get();
    if (existing) throw new ConflictError(`Tag already exists: ${parsed.name}`);
    const [row] = ctx.db
      .insert(tags)
      .values({ ...parsed, userId: ctx.userId })
      .returning()
      .all();
    return row!;
  },

  get(ctx: Ctx, id: string): Tag {
    const row = ctx.db
      .select()
      .from(tags)
      .where(and(eq(tags.id, id), userScope(tags, ctx.userId)))
      .get();
    if (!row) throw new NotFoundError('Tag', id);
    return row;
  },

  list(ctx: Ctx): Tag[] {
    return ctx.db
      .select()
      .from(tags)
      .where(userScope(tags, ctx.userId))
      .orderBy(asc(tags.name))
      .all();
  },

  update(ctx: Ctx, id: string, patch: UpdateTagInput): Tag {
    const parsed = updateTagSchema.parse(patch);
    tagService.get(ctx, id);
    if (parsed.name !== undefined) {
      const clash = ctx.db
        .select()
        .from(tags)
        .where(and(userScope(tags, ctx.userId), eq(tags.name, parsed.name)))
        .get();
      if (clash && clash.id !== id) throw new ConflictError(`Tag already exists: ${parsed.name}`);
    }
    const [row] = ctx.db
      .update(tags)
      .set({ ...parsed, updatedAt: new Date() })
      .where(and(eq(tags.id, id), userScope(tags, ctx.userId)))
      .returning()
      .all();
    return row!;
  },

  remove(ctx: Ctx, id: string): void {
    tagService.get(ctx, id);
    ctx.db
      .delete(tags)
      .where(and(eq(tags.id, id), userScope(tags, ctx.userId)))
      .run();
  },

  attach(ctx: Ctx, taskId: string, tagId: string): void {
    requireOwnedTask(ctx, taskId); // task must be owned
    tagService.get(ctx, tagId); // tag must be owned
    ctx.db.insert(taskTags).values({ taskId, tagId }).onConflictDoNothing().run();
  },

  detach(ctx: Ctx, taskId: string, tagId: string): void {
    requireOwnedTask(ctx, taskId);
    ctx.db
      .delete(taskTags)
      .where(and(eq(taskTags.taskId, taskId), eq(taskTags.tagId, tagId)))
      .run();
  },

  listForTask(ctx: Ctx, taskId: string): Tag[] {
    requireOwnedTask(ctx, taskId);
    return ctx.db
      .select({
        id: tags.id,
        userId: tags.userId,
        name: tags.name,
        color: tags.color,
        createdAt: tags.createdAt,
        updatedAt: tags.updatedAt,
      })
      .from(taskTags)
      .innerJoin(tags, eq(taskTags.tagId, tags.id))
      .where(eq(taskTags.taskId, taskId))
      .orderBy(asc(tags.name))
      .all();
  },
};
