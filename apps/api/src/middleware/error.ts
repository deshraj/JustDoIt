import type { Context } from 'hono';
import { ZodError } from 'zod';
import { NotFoundError, ValidationError, ConflictError } from '@justdoit/core';

export function errorHandler(err: Error, c: Context): Response {
  if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
  if (err instanceof ValidationError) return c.json({ error: err.message }, 400);
  if (err instanceof ConflictError) return c.json({ error: err.message }, 409);
  if (err instanceof ZodError) {
    return c.json({ error: 'Validation failed', issues: err.issues }, 400);
  }
  console.error(err);
  return c.json({ error: 'Internal server error' }, 500);
}
