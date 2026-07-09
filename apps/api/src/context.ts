import type { Ctx } from '@justdoit/core';

/** Hono per-request environment: every route reads `c.var.ctx`. */
export type AppEnv = { Variables: { ctx: Ctx } };
