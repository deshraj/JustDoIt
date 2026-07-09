import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { userService } from './user-service';
import { apiKeyService } from './api-key-service';
import { NotFoundError } from '../errors';

function seed(): { db: Db; userId: string } {
  const { db } = createDb(':memory:');
  runMigrations(db);
  const user = userService.create(db, { githubId: 'gh', name: 'Owner' });
  return { db, userId: user.id };
}

describe('apiKeyService', () => {
  let db: Db;
  let userId: string;
  beforeEach(() => {
    ({ db, userId } = seed());
  });

  it('create returns a raw token once and stores only its hash', () => {
    const { apiKey, token } = apiKeyService.create(db, userId, 'CLI');
    expect(token).toMatch(/^jdk_/);
    expect(apiKey.tokenHash).not.toBe(token);
    expect(apiKey.tokenHash).toHaveLength(64); // sha-256 hex
    expect(apiKey.name).toBe('CLI');
  });

  it('resolveToken maps a raw token to its owner and stamps last_used_at', () => {
    const { token } = apiKeyService.create(db, userId, 'CLI');
    const now = new Date('2026-07-08T00:00:00Z');
    expect(apiKeyService.resolveToken(db, token, now)).toBe(userId);
    const [key] = apiKeyService.listForUser(db, userId);
    expect(key!.lastUsedAt?.getTime()).toBe(now.getTime());
  });

  it('resolveToken returns null for an unknown or revoked token', () => {
    const { token } = apiKeyService.create(db, userId, 'CLI');
    expect(apiKeyService.resolveToken(db, 'jdk_bogus')).toBeNull();
    const [key] = apiKeyService.listForUser(db, userId);
    apiKeyService.revoke(db, userId, key!.id);
    expect(apiKeyService.resolveToken(db, token)).toBeNull();
  });

  it('revoke is owner-scoped — a different user cannot revoke', () => {
    const other = userService.create(db, { githubId: 'gh2', name: 'Other' }).id;
    const [key] = [apiKeyService.create(db, userId, 'CLI').apiKey];
    expect(() => apiKeyService.revoke(db, other, key!.id)).toThrow(NotFoundError);
    expect(apiKeyService.listForUser(db, userId)).toHaveLength(1);
  });
});
