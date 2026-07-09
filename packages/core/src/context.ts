import type { Db } from './db';
export { LOCAL_USER_ID } from './constants';

/** Per-request tenant context. Every user-owned service method takes this. */
export interface Ctx {
  db: Db;
  userId: string;
}
