import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, runMigrations } from '../db/client';
import { NotFoundError, ValidationError } from '../errors';
import { taskService } from './task-service';
import { attachmentService } from './attachment-service';
import { LOCAL_USER_ID } from '../constants';

const dirs: string[] = [];
async function filesDir() {
  const d = await fs.mkdtemp(join(tmpdir(), 'justdoit-files-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('attachmentService', () => {
  it('stores a file on disk and lists it', async () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const fdir = await filesDir();
    const task = taskService.create({ db, userId: LOCAL_USER_ID }, { title: 'With file' });

    const rec = await attachmentService.add(
      db,
      {
        taskId: task.id,
        filename: 'note.txt',
        mime: 'text/plain',
        data: new TextEncoder().encode('hello'),
      },
      { filesDir: fdir },
    );
    expect(rec.size).toBe(5);
    expect(attachmentService.list(db, task.id)).toHaveLength(1);

    const got = attachmentService.get(db, rec.id, { filesDir: fdir });
    expect(await fs.readFile(got.absolutePath, 'utf8')).toBe('hello');
  });

  it('rejects a disallowed mime type and an oversized file', async () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const fdir = await filesDir();
    const task = taskService.create({ db, userId: LOCAL_USER_ID }, { title: 'T' });
    await expect(
      attachmentService.add(
        db,
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
    const fdir = await filesDir();
    await expect(
      attachmentService.add(
        db,
        { taskId: 'ghost', filename: 'a.txt', mime: 'text/plain', data: new Uint8Array(1) },
        { filesDir: fdir },
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('removes the file and the row', async () => {
    const { db } = createDb(':memory:');
    runMigrations(db);
    const fdir = await filesDir();
    const task = taskService.create({ db, userId: LOCAL_USER_ID }, { title: 'T' });
    const rec = await attachmentService.add(
      db,
      { taskId: task.id, filename: 'x.txt', mime: 'text/plain', data: new Uint8Array([1]) },
      { filesDir: fdir },
    );
    await attachmentService.remove(db, rec.id, { filesDir: fdir });
    expect(attachmentService.list(db, task.id)).toHaveLength(0);
  });
});
