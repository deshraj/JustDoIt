import { and, desc, eq } from 'drizzle-orm';
import { savedFilters, type SavedFilterRow } from '../db/schema';
import { NotFoundError } from '../errors';
import {
  createSavedFilterSchema,
  updateSavedFilterSchema,
  type CreateSavedFilterInput,
  type UpdateSavedFilterInput,
} from '../schemas/saved-filter';
import { userScope } from '../scope';
import type { Ctx } from '../context';

export type SavedFilterRecord = SavedFilterRow;

export const savedFilterService = {
  create(ctx: Ctx, input: CreateSavedFilterInput, now: Date = new Date()): SavedFilterRecord {
    const parsed = createSavedFilterSchema.parse(input);
    const [row] = ctx.db
      .insert(savedFilters)
      .values({
        userId: ctx.userId,
        name: parsed.name,
        query: parsed.query,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all();
    return row!;
  },

  list(ctx: Ctx): SavedFilterRecord[] {
    return ctx.db
      .select()
      .from(savedFilters)
      .where(userScope(savedFilters, ctx.userId))
      .orderBy(desc(savedFilters.createdAt))
      .all();
  },

  get(ctx: Ctx, id: string): SavedFilterRecord {
    const row = ctx.db
      .select()
      .from(savedFilters)
      .where(and(eq(savedFilters.id, id), userScope(savedFilters, ctx.userId)))
      .get();
    if (!row) throw new NotFoundError('Saved filter', id);
    return row;
  },

  update(
    ctx: Ctx,
    id: string,
    input: UpdateSavedFilterInput,
    now: Date = new Date(),
  ): SavedFilterRecord {
    const parsed = updateSavedFilterSchema.parse(input);
    savedFilterService.get(ctx, id); // throws NotFoundError if absent
    const [row] = ctx.db
      .update(savedFilters)
      .set({
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.query !== undefined ? { query: parsed.query } : {}),
        updatedAt: now,
      })
      .where(and(eq(savedFilters.id, id), userScope(savedFilters, ctx.userId)))
      .returning()
      .all();
    return row!;
  },

  remove(ctx: Ctx, id: string): void {
    const deleted = ctx.db
      .delete(savedFilters)
      .where(and(eq(savedFilters.id, id), userScope(savedFilters, ctx.userId)))
      .returning()
      .all();
    if (deleted.length === 0) throw new NotFoundError('Saved filter', id);
  },
};
