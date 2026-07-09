import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { attachmentService, ValidationError, type Db } from '@justdoit/core';
import type { AppEnv } from '../context';

/**
 * Build a header-safe `Content-Disposition` value. A raw filename can contain
 * quotes, control characters, or non-ASCII bytes that would break the header
 * (or crash the response writer). We emit an ASCII fallback with those
 * characters stripped plus an RFC 5987 `filename*` carrying the exact name.
 */
function contentDisposition(filename: string | null | undefined): string {
  const name = filename ?? 'file';
  const asciiFallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'file';
  const encoded = encodeURIComponent(name);
  return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

export function attachmentRoutes(db: Db, filesDir: string): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.post('/tasks/:id/attachments', async (c) => {
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) {
      throw new ValidationError('Expected a multipart field "file"');
    }
    const data = new Uint8Array(await file.arrayBuffer());
    const attachment = await attachmentService.add(
      c.var.ctx,
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
    c.json({ attachments: attachmentService.list(c.var.ctx, c.req.param('id')) }),
  );

  r.get('/attachments/:id', async (c) => {
    const { record, absolutePath } = attachmentService.get(c.var.ctx, c.req.param('id'), {
      filesDir,
    });
    const bytes = await readFile(absolutePath);
    c.header('Content-Type', record.mime ?? 'application/octet-stream');
    c.header('Content-Disposition', contentDisposition(record.filename));
    return c.body(new Uint8Array(bytes));
  });

  r.delete('/attachments/:id', async (c) => {
    await attachmentService.remove(c.var.ctx, c.req.param('id'), { filesDir });
    return c.body(null, 204);
  });

  return r;
}
