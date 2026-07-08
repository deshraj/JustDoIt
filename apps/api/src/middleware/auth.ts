import type { MiddlewareHandler } from 'hono';

/**
 * API-key gate for a local-first single-user tool.
 *
 * When `apiKey` is set, every request must carry a matching `X-API-Key`
 * header or it is rejected with 401. When `apiKey` is undefined/empty the
 * middleware is a no-op, preserving the zero-config localhost dev UX.
 *
 * CORS preflight (`OPTIONS`) never reaches this middleware because the `cors`
 * middleware is registered first and short-circuits preflight requests.
 */
export function apiKeyAuth(apiKey: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (!apiKey) return next();
    if (c.req.header('X-API-Key') !== apiKey) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    return next();
  };
}
