import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, runMigrations, type Db } from '../db';
import { NotFoundError, ValidationError } from '../errors';
import { taskService } from './task-service';
import { attachmentService } from './attachment-service';
import { userService } from './user-service';
import { LOCAL_USER_ID } from '../constants';
import type { Ctx } from '../context';

const dirs: string[] = [];
async function filesDir() {
  const d = await fs.mkdtemp(join(tmpdir(), 'justdoit-files-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

function ctxFor(db: Db, userId: string): Ctx {
  return { db, userId };
}

describe('attachmentService', () => {
  it('stores a file on disk and lists it', async () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const ctx = ctxFor(db, LOCAL_USER_ID);
    const fdir = await filesDir();
    const task = taskService.create(ctx, { title: 'With file' });

    const rec = await attachmentService.add(
      ctx,
      {
        taskId: task.id,
        filename: 'note.txt',
        mime: 'text/plain',
        data: new TextEncoder().encode('hello'),
      },
      { filesDir: fdir },
    );
    expect(rec.size).toBe(5);
    expect(attachmentService.list(ctx, task.id)).toHaveLength(1);

    const got = attachmentService.get(ctx, rec.id, { filesDir: fdir });
    expect(await fs.readFile(got.absolutePath, 'utf8')).toBe('hello');
  });

  it('rejects a disallowed mime type and an oversized file', async () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const ctx = ctxFor(db, LOCAL_USER_ID);
    const fdir = await filesDir();
    const task = taskService.create(ctx, { title: 'T' });
    await expect(
      attachmentService.add(
        ctx,
        {
          taskId: task.id,
          filename: 'a.exe',
          mime: 'application/x-msdownload',
          data: new Uint8Array(1),
        },
        { filesDir: fdir },
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('throws NotFoundError for an unknown task', async () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const ctx = ctxFor(db, LOCAL_USER_ID);
    const fdir = await filesDir();
    await expect(
      attachmentService.add(
        ctx,
        { taskId: 'ghost', filename: 'a.txt', mime: 'text/plain', data: new Uint8Array(1) },
        { filesDir: fdir },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('removes the file and the row', async () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const ctx = ctxFor(db, LOCAL_USER_ID);
    const fdir = await filesDir();
    const task = taskService.create(ctx, { title: 'T' });
    const rec = await attachmentService.add(
      ctx,
      { taskId: task.id, filename: 'x.txt', mime: 'text/plain', data: new Uint8Array([1]) },
      { filesDir: fdir },
    );
    await attachmentService.remove(ctx, rec.id, { filesDir: fdir });
    expect(attachmentService.list(ctx, task.id)).toHaveLength(0);
  });

  describe('cross-tenant isolation', () => {
    it('A cannot add onto B task, nor list/get/remove B attachments', async () => {
      const { db } = createDb(':memory:');
      runMigrations(db);
      userService.create(db, { id: 'user-b', name: 'B' });
      const a = ctxFor(db, LOCAL_USER_ID);
      const b = ctxFor(db, 'user-b');
      const fdir = await filesDir();

      const bTask = taskService.create(b, { title: 'B' });
      await expect(
        attachmentService.add(
          a,
          { taskId: bTask.id, filename: 'x.txt', mime: 'text/plain', data: new Uint8Array([1]) },
          { filesDir: fdir },
        ),
      ).rejects.toThrow(NotFoundError);

      const att = await attachmentService.add(
        b,
        { taskId: bTask.id, filename: 'y.txt', mime: 'text/plain', data: new Uint8Array([1]) },
        { filesDir: fdir },
      );
      expect(attachmentService.list(a, bTask.id)).toHaveLength(0);
      expect(() => attachmentService.get(a, att.id, { filesDir: fdir })).toThrow(NotFoundError);
      await expect(attachmentService.remove(a, att.id, { filesDir: fdir })).rejects.toThrow(
        NotFoundError,
      );
    });
  });
});
