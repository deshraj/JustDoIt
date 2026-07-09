import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, runMigrations, taskService, LOCAL_USER_ID } from '@justdoit/core';
import { createApp } from '../app';

interface AttachmentJson {
  id: string;
  filename: string;
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

async function harness() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  const filesDir = await fs.mkdtemp(join(tmpdir(), 'jd-api-'));
  dirs.push(filesDir);
  return { db, filesDir, app: createApp(db, { filesDir }) };
}

describe('attachment routes', () => {
  it('uploads (multipart), lists, downloads, and deletes', async () => {
    const { db, app } = await harness();
    const task = taskService.create({ db, userId: LOCAL_USER_ID }, { title: 'T' });

    const form = new FormData();
    form.append('file', new File(['hello'], 'note.txt', { type: 'text/plain' }));
    const up = await app.request(`/tasks/${task.id}/attachments`, { method: 'POST', body: form });
    expect(up.status).toBe(201);
    const { attachment } = (await up.json()) as { attachment: AttachmentJson };
    expect(attachment.filename).toBe('note.txt');

    const list = await app.request(`/tasks/${task.id}/attachments`);
    const listBody = (await list.json()) as { attachments: AttachmentJson[] };
    expect(listBody.attachments).toHaveLength(1);

    const dl = await app.request(`/attachments/${attachment.id}`);
    expect(dl.status).toBe(200);
    expect(await dl.text()).toBe('hello');

    const del = await app.request(`/attachments/${attachment.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
  });

  it('400s on a disallowed type', async () => {
    const { db, app } = await harness();
    const task = taskService.create({ db, userId: LOCAL_USER_ID }, { title: 'T' });
    const form = new FormData();
    form.append('file', new File(['x'], 'a.exe', { type: 'application/x-msdownload' }));
    const up = await app.request(`/tasks/${task.id}/attachments`, { method: 'POST', body: form });
    expect(up.status).toBe(400);
  });

  it('404s downloading an unknown attachment id', async () => {
    const { app } = await harness();
    const res = await app.request('/attachments/nope');
    expect(res.status).toBe(404);
  });

  it('emits a header-safe Content-Disposition for hostile filenames', async () => {
    const { db, app } = await harness();
    const task = taskService.create({ db, userId: LOCAL_USER_ID }, { title: 'T' });

    const form = new FormData();
    // Quote + control char (newline) that would break the header if inlined.
    form.append('file', new File(['x'], 'a"\n.txt', { type: 'text/plain' }));
    const up = await app.request(`/tasks/${task.id}/attachments`, { method: 'POST', body: form });
    expect(up.status).toBe(201);
    const { attachment } = (await up.json()) as { attachment: AttachmentJson };

    const dl = await app.request(`/attachments/${attachment.id}`);
    expect(dl.status).toBe(200);
    expect(await dl.text()).toBe('x');
    const disposition = dl.headers.get('Content-Disposition') ?? '';
    // ASCII fallback must not carry raw quotes or control chars…
    const fallback = disposition.split('filename*=')[0] ?? '';
    expect(fallback).not.toMatch(/[\r\n]/);
    expect(fallback.match(/"/g)?.length).toBe(2); // only the two wrapping quotes
    // …and the exact name is preserved via RFC 5987 filename*.
    expect(disposition).toContain("filename*=UTF-8''");
  });
});
