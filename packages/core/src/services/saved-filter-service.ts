import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { savedFilters, type SavedFilterRow } from '../db/schema';
import { NotFoundError } from '../errors';
import {
  createSavedFilterSchema,
  updateSavedFilterSchema,
  type CreateSavedFilterInput,
  type UpdateSavedFilterInput,
} from '../schemas/saved-filter';

export type SavedFilterRecord = SavedFilterRow;

export const savedFilterService = {
  create(db: Db, input: CreateSavedFilterInput, now: Date = new Date()): SavedFilterRecord {
    const parsed = createSavedFilterSchema.parse(input);
    const [row] = db
      .insert(savedFilters)
      .values({ name: parsed.name, query: parsed.query, createdAt: now, updatedAt: now })
      .returning()
      .all();
    return row!;
  },

  list(db: Db): SavedFilterRecord[] {
    return db.select().from(savedFilters).orderBy(desc(savedFilters.createdAt)).all();
  },

  get(db: Db, id: string): SavedFilterRecord {
    const row = db.select().from(savedFilters).where(eq(savedFilters.id, id)).get();
    if (!row) throw new NotFoundError('Saved filter', id);
    return row;
  },

  update(
    db: Db,
    id: string,
    input: UpdateSavedFilterInput,
    now: Date = new Date(),
  ): SavedFilterRecord {
    const parsed = updateSavedFilterSchema.parse(input);
    savedFilterService.get(db, id); // throws NotFoundError if absent
    const [row] = db
      .update(savedFilters)
      .set({
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.query !== undefined ? { query: parsed.query } : {}),
        updatedAt: now,
      })
      .where(eq(savedFilters.id, id))
      .returning()
      .all();
    return row!;
  },

  remove(db: Db, id: string): void {
    const deleted = db.delete(savedFilters).where(eq(savedFilters.id, id)).returning().all();
    if (deleted.length === 0) throw new NotFoundError('Saved filter', id);
  },
};
