import type { MiddlewareHandler } from 'hono';
import { apiKeyService, LOCAL_USER_ID, type Db } from '@justdoit/core';
import type { AppEnv } from '../context';

export interface ResolveUserOptions {
  /** Shared secret the web proxy sends as `X-Internal-Key`. */
  internalSecret?: string;
  /** `hosted` requires an identity; `local` falls back to the implicit user. */
  mode?: 'local' | 'hosted';
}

/**
 * Resolve the acting `userId` for every request and stash `ctx = { db, userId }`
 * for the routes. Resolution order (see Phase 7 spec §6):
 *   1. valid `X-Internal-Key` → trust `X-User-Id`   (the web proxy)
 *   2. present `X-API-Key`     → apiKeyService.resolveToken → userId | 401
 *   3. local mode              → LOCAL_USER_ID
 *   4. hosted, no identity     → 401
 */
export function resolveUser(db: Db, opts: ResolveUserOptions = {}): MiddlewareHandler<AppEnv> {
  const internalSecret = opts.internalSecret ?? process.env.INTERNAL_API_SECRET;
  const mode = opts.mode ?? (process.env.JUSTDOIT_MODE === 'hosted' ? 'hosted' : 'local');

  return async (c, next) => {
    const internalKey = c.req.header('X-Internal-Key');
    if (internalKey !== undefined) {
      if (!internalSecret || internalKey !== internalSecret) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      const userId = c.req.header('X-User-Id');
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);
      c.set('ctx', { db, userId });
      return next();
    }

    const apiKey = c.req.header('X-API-Key');
    if (apiKey !== undefined) {
      const userId = apiKeyService.resolveToken(db, apiKey);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);
      c.set('ctx', { db, userId });
      return next();
    }

    if (mode === 'local') {
      c.set('ctx', { db, userId: LOCAL_USER_ID });
      return next();
    }
    return c.json({ error: 'Unauthorized' }, 401);
  };
}
