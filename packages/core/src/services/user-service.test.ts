import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, runMigrations, type Db } from '../db';
import { userService } from './user-service';
import { LOCAL_USER_ID } from '../constants';
import { NotFoundError } from '../errors';

function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

describe('userService', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });

  it('the migration-seeded local user is retrievable', () => {
    expect(userService.get(db, LOCAL_USER_ID).id).toBe(LOCAL_USER_ID);
  });

  it('ensureLocalUser is idempotent', () => {
    const a = userService.ensureLocalUser(db);
    const b = userService.ensureLocalUser(db);
    expect(a.id).toBe(LOCAL_USER_ID);
    expect(b.id).toBe(LOCAL_USER_ID);
  });

  it('creates and reads a user', () => {
    const u = userService.create(db, { githubId: 'gh-1', email: 'a@b.co', name: 'A' });
    expect(u.id).toMatch(/[0-9a-f-]{36}/);
    expect(userService.get(db, u.id).githubId).toBe('gh-1');
  });

  it('get throws NotFoundError for unknown id', () => {
    expect(() => userService.get(db, 'nope')).toThrow(NotFoundError);
  });

  it('upsertByGithubId inserts then updates the same row', () => {
    const first = userService.upsertByGithubId(db, { githubId: 'gh-9', name: 'Old' });
    const second = userService.upsertByGithubId(db, { githubId: 'gh-9', name: 'New' });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe('New');
    expect(userService.getByGithubId(db, 'gh-9')?.id).toBe(first.id);
  });
});
