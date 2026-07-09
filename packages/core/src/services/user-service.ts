import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { users, type User } from '../db/schema';
import { LOCAL_USER_ID } from '../constants';
import { NotFoundError } from '../errors';
import {
  createUserSchema,
  upsertGithubUserSchema,
  type CreateUserInput,
  type UpsertGithubUserInput,
} from '../schemas/user';

export const userService = {
  create(db: Db, input: CreateUserInput): User {
    const parsed = createUserSchema.parse(input);
    const [row] = db
      .insert(users)
      .values({
        ...(parsed.id ? { id: parsed.id } : {}),
        githubId: parsed.githubId ?? null,
        email: parsed.email ?? null,
        name: parsed.name ?? null,
        avatarUrl: parsed.avatarUrl ?? null,
      })
      .returning()
      .all();
    return row!;
  },

  get(db: Db, id: string): User {
    const row = db.select().from(users).where(eq(users.id, id)).get();
    if (!row) throw new NotFoundError('User', id);
    return row;
  },

  getByGithubId(db: Db, githubId: string): User | null {
    return db.select().from(users).where(eq(users.githubId, githubId)).get() ?? null;
  },

  upsertByGithubId(db: Db, input: UpsertGithubUserInput): User {
    const parsed = upsertGithubUserSchema.parse(input);
    const existing = userService.getByGithubId(db, parsed.githubId);
    if (existing) {
      const [row] = db
        .update(users)
        .set({
          email: parsed.email ?? existing.email,
          name: parsed.name ?? existing.name,
          avatarUrl: parsed.avatarUrl ?? existing.avatarUrl,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning()
        .all();
      return row!;
    }
    return userService.create(db, parsed);
  },

  /** Idempotently ensure the fixed local user exists (adapters/tests call this). */
  ensureLocalUser(db: Db): User {
    const existing = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).get();
    if (existing) return existing;
    return userService.create(db, { id: LOCAL_USER_ID, name: 'Local User' });
  },
};
