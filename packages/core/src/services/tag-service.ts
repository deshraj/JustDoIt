import { eq, asc, and } from 'drizzle-orm';
import type { Db } from '../db';
import { tags, taskTags, tasks, type Tag } from '../db/schema';
import { NotFoundError, ConflictError } from '../errors';
import {
  createTagSchema,
  updateTagSchema,
  type CreateTagInput,
  type UpdateTagInput,
} from '../schemas';

function requireTask(db: Db, taskId: string): void {
  const row = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).get();
  if (!row) throw new NotFoundError('Task', taskId);
}

export const tagService = {
  create(db: Db, input: CreateTagInput): Tag {
    const parsed = createTagSchema.parse(input);
    const existing = db.select().from(tags).where(eq(tags.name, parsed.name)).get();
    if (existing) throw new ConflictError(`Tag already exists: ${parsed.name}`);
    const [row] = db.insert(tags).values(parsed).returning().all();
    return row!;
  },

  get(db: Db, id: string): Tag {
    const row = db.select().from(tags).where(eq(tags.id, id)).get();
    if (!row) throw new NotFoundError('Tag', id);
    return row;
  },

  list(db: Db): Tag[] {
    return db.select().from(tags).orderBy(asc(tags.name)).all();
  },

  update(db: Db, id: string, patch: UpdateTagInput): Tag {
    const parsed = updateTagSchema.parse(patch);
    tagService.get(db, id);
    if (parsed.name !== undefined) {
      const clash = db.select().from(tags).where(eq(tags.name, parsed.name)).get();
      if (clash && clash.id !== id) throw new ConflictError(`Tag already exists: ${parsed.name}`);
    }
    const [row] = db
      .update(tags)
      .set({ ...parsed, updatedAt: new Date() })
      .where(eq(tags.id, id))
      .returning()
      .all();
    return row!;
  },

  remove(db: Db, id: string): void {
    tagService.get(db, id);
    db.delete(tags).where(eq(tags.id, id)).run();
  },

  attach(db: Db, taskId: string, tagId: string): void {
    requireTask(db, taskId);
    tagService.get(db, tagId);
    db.insert(taskTags).values({ taskId, tagId }).onConflictDoNothing().run();
  },

  detach(db: Db, taskId: string, tagId: string): void {
    db.delete(taskTags)
      .where(and(eq(taskTags.taskId, taskId), eq(taskTags.tagId, tagId)))
      .run();
  },

  listForTask(db: Db, taskId: string): Tag[] {
    return db
      .select({
        id: tags.id,
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
