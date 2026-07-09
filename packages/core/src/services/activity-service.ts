import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { activityLog, type ActivityLogEntry } from '../db/schema';
import { events, type DomainEvent, type EntityType } from '../events/bus';
import { userScope } from '../scope';
import type { Ctx } from '../context';

export type ActivityEntry = ActivityLogEntry;

export interface ListActivityInput {
  entityType?: EntityType;
  entityId?: string;
  limit?: number;
}

export const activityService = {
  record(db: Db, event: DomainEvent): ActivityEntry {
    const [row] = db
      .insert(activityLog)
      .values({
        userId: event.userId,
        entityType: event.entityType,
        entityId: event.entityId,
        action: event.action,
        payload: event.payload ?? null,
        createdAt: new Date(event.at),
      })
      .returning()
      .all();
    return row!;
  },

  list(ctx: Ctx, input: ListActivityInput = {}): ActivityEntry[] {
    const conds = [userScope(activityLog, ctx.userId)];
    if (input.entityType) conds.push(eq(activityLog.entityType, input.entityType));
    if (input.entityId) conds.push(eq(activityLog.entityId, input.entityId));
    return (
      ctx.db
        .select()
        .from(activityLog)
        .where(and(...conds))
        // `id` is a random UUID (no chronological meaning), so ties within the
        // same millisecond are broken by SQLite's implicit rowid, which is
        // exactly insertion order — unlike the UUID, monotonically increasing.
        .orderBy(desc(activityLog.createdAt), desc(sql`rowid`))
        .limit(input.limit ?? 100)
        .all()
    );
  },
};

/** Attach the persistence subscriber to the bus. Returns an unsubscribe fn. */
export function startActivityLog(db: Db): () => void {
  return events.subscribe((event) => {
    activityService.record(db, event);
  });
}
