import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

export interface CreateDbResult {
  db: Db;
  sqlite: Database.Database;
}

export function createDb(url = 'justdoit.db'): CreateDbResult {
  const sqlite = new Database(url);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

const DEFAULT_MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export function runMigrations(db: Db, migrationsFolder: string = DEFAULT_MIGRATIONS_DIR): void {
  migrate(db, { migrationsFolder });
}
