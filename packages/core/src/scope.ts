import { eq, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

/** Centralized owner predicate — every scoped read composes this to avoid drift. */
export function userScope(table: { userId: SQLiteColumn }, userId: string): SQL {
  return eq(table.userId, userId);
}
