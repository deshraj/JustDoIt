import { Hono } from 'hono';
import { z } from 'zod';
import { activityService, ValidationError, LOCAL_USER_ID, type Db } from '@justdoit/core';

const ENTITY_TYPES = ['task', 'project', 'time_entry'] as const;

const querySchema = z
  .object({
    entity: z
      .string()
      .regex(/^(task|project|time_entry):.+$/, 'entity must be "<type>:<id>"')
      .optional(),
    entityType: z.enum(ENTITY_TYPES).optional(),
    entityId: z.string().optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
  })
  .transform((q) => {
    if (q.entity) {
      const [entityType, entityId] = q.entity.split(/:(.+)/) as [
        (typeof ENTITY_TYPES)[number],
        string,
      ];
      return { entityType, entityId, limit: q.limit };
    }
    return { entityType: q.entityType, entityId: q.entityId, limit: q.limit };
  });

export function activityRoutes(db: Db): Hono {
  const r = new Hono();

  r.get('/activity', (c) => {
    const parsed = querySchema.safeParse(c.req.query());
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]!.message);
    // interim, until Task 4 registers the setUserContext middleware:
    const ctx = { db, userId: LOCAL_USER_ID };
    return c.json({ activity: activityService.list(ctx, parsed.data) });
  });

  return r;
}
