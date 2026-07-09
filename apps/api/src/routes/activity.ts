import { Hono } from 'hono';
import { z } from 'zod';
import { activityService, ValidationError, type Db } from '@justdoit/core';
import type { AppEnv } from '../context';

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

export function activityRoutes(db: Db): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/activity', (c) => {
    const parsed = querySchema.safeParse(c.req.query());
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]!.message);
    return c.json({ activity: activityService.list(c.var.ctx, parsed.data) });
  });

  return r;
}
