import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { apiKeys, type ApiKey } from '../db/schema';
import { NotFoundError } from '../errors';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface CreateApiKeyResult {
  apiKey: ApiKey;
  /** Raw token — shown to the caller exactly once; never persisted. */
  token: string;
}

export const apiKeyService = {
  create(db: Db, userId: string, name: string, now: Date = new Date()): CreateApiKeyResult {
    const token = `jdk_${randomBytes(24).toString('base64url')}`;
    const [apiKey] = db
      .insert(apiKeys)
      .values({ userId, name, tokenHash: hashToken(token), createdAt: now })
      .returning()
      .all();
    return { apiKey: apiKey!, token };
  },

  listForUser(db: Db, userId: string): ApiKey[] {
    return db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(asc(apiKeys.createdAt))
      .all();
  },

  revoke(db: Db, userId: string, id: string): void {
    const deleted = db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .returning()
      .all();
    if (deleted.length === 0) throw new NotFoundError('API key', id);
  },

  /** Resolve a raw token to its owner id (or null), stamping last_used_at on hit. */
  resolveToken(db: Db, rawToken: string, now: Date = new Date()): string | null {
    const row = db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.tokenHash, hashToken(rawToken)))
      .get();
    if (!row) return null;
    db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, row.id)).run();
    return row.userId;
  },
};
