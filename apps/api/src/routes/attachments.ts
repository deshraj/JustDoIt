import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { attachmentService, ValidationError, type Db } from '@justdoit/core';

export function attachmentRoutes(db: Db, filesDir: string): Hono {
  const r = new Hono();

  r.post('/tasks/:id/attachments', async (c) => {
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) {
      throw new ValidationError('Expected a multipart field "file"');
    }
    const data = new Uint8Array(await file.arrayBuffer());
    const attachment = await attachmentService.add(
      db,
      {
        taskId: c.req.param('id'),
        filename: file.name,
        mime: file.type || 'application/octet-stream',
        data,
      },
      { filesDir },
    );
    return c.json({ attachment }, 201);
  });

  r.get('/tasks/:id/attachments', (c) =>
    c.json({ attachments: attachmentService.list(db, c.req.param('id')) }),
  );

  r.get('/attachments/:id', async (c) => {
    const { record, absolutePath } = attachmentService.get(db, c.req.param('id'), { filesDir });
    const bytes = await readFile(absolutePath);
    c.header('Content-Type', record.mime ?? 'application/octet-stream');
    c.header('Content-Disposition', `inline; filename="${record.filename}"`);
    return c.body(new Uint8Array(bytes));
  });

  r.delete('/attachments/:id', async (c) => {
    await attachmentService.remove(db, c.req.param('id'), { filesDir });
    return c.body(null, 204);
  });

  return r;
}
