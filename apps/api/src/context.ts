import type { MiddlewareHandler } from 'hono';
import { LOCAL_USER_ID, type Ctx, type Db } from '@justdoit/core';

/** Hono per-request environment: every route reads `c.var.ctx`. */
export type AppEnv = { Variables: { ctx: Ctx } };

/**
 * Set the per-request tenant context. Phase 7a is local mode only, so `userId`
 * always defaults to the fixed local user. Phase 7b replaces the body with the
 * X-Internal-Key / X-API-Key / local resolution ladder (spec §6); routes do not change.
 */
export function setUserContext(db: Db): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('ctx', { db, userId: LOCAL_USER_ID });
    return next();
  };
}
