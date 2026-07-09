import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const migration = (tag: string): string =>
  readFileSync(resolve(here, `../drizzle/${tag}.sql`), 'utf8').replaceAll(
    '--> statement-breakpoint',
    '',
  );

describe('0001 multitenancy migration', () => {
  it('creates the local user and backfills user_id on pre-existing rows', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');

    // Baseline schema (0000) + legacy data that predates tenancy.
    sqlite.exec(migration('0000_solid_molten_man'));
    sqlite
      .prepare(
        `INSERT INTO projects (id, name, position, archived, created_at, updated_at)
       VALUES ('p1', 'Legacy', 0, 0, 0, 0)`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO tasks (id, title, status, position, archived, created_at, updated_at)
       VALUES ('t1', 'Legacy task', 'todo', 0, 0, 0, 0)`,
      )
      .run();
    sqlite
      .prepare(`INSERT INTO tags (id, name, created_at, updated_at) VALUES ('g1', 'legacy', 0, 0)`)
      .run();

    // Apply the tenancy migration.
    sqlite.exec(migration('0001_multitenancy'));

    // Local user exists.
    const u = sqlite.prepare(`SELECT id, name FROM users WHERE id = 'local-user'`).get() as
      | { id: string; name: string }
      | undefined;
    expect(u?.id).toBe('local-user');

    // Existing rows are backfilled.
    for (const table of ['projects', 'tasks', 'tags']) {
      const row = sqlite.prepare(`SELECT user_id FROM ${table} LIMIT 1`).get() as {
        user_id: string;
      };
      expect(row.user_id).toBe('local-user');
    }

    // Per-user tag uniqueness: same name allowed for a different user.
    sqlite.prepare(`INSERT INTO users (id, created_at, updated_at) VALUES ('u2', 0, 0)`).run();
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO tags (id, user_id, name, created_at, updated_at) VALUES ('g2', 'u2', 'legacy', 0, 0)`,
        )
        .run(),
    ).not.toThrow();
    // …but a duplicate (user, name) is rejected.
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO tags (id, user_id, name, created_at, updated_at) VALUES ('g3', 'local-user', 'legacy', 0, 0)`,
        )
        .run(),
    ).toThrow();

    sqlite.close();
  });
});
