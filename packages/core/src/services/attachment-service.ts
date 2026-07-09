import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { attachments, tasks, type AttachmentRow } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';
import { userScope } from '../scope';
import type { Ctx } from '../context';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB

export const ALLOWED_ATTACHMENT_MIME = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/zip',
]);

const DEFAULT_FILES_DIR = './data/files';

export interface AddAttachmentInput {
  taskId: string;
  filename: string;
  mime: string;
  data: Uint8Array;
}

export type AttachmentRecord = AttachmentRow;

function sanitize(filename: string): string {
  return filename.replace(/[/\\]/g, '_').slice(0, 200) || 'file';
}

function requireOwnedTask(ctx: Ctx, taskId: string): void {
  const row = ctx.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), userScope(tasks, ctx.userId)))
    .get();
  if (!row) throw new NotFoundError('Task', taskId);
}

export const attachmentService = {
  async add(
    ctx: Ctx,
    input: AddAttachmentInput,
    opts: { filesDir?: string } = {},
  ): Promise<AttachmentRecord> {
    const filesDir = opts.filesDir ?? DEFAULT_FILES_DIR;
    if (input.data.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new ValidationError(`File exceeds ${MAX_ATTACHMENT_BYTES} bytes`);
    }
    if (!ALLOWED_ATTACHMENT_MIME.has(input.mime)) {
      throw new ValidationError(`Unsupported file type: ${input.mime}`);
    }
    requireOwnedTask(ctx, input.taskId);

    const safeName = sanitize(input.filename);
    const storedName = `${randomUUID()}${extname(safeName)}`;
    const relPath = join(input.taskId, storedName);
    const absPath = join(filesDir, relPath);
    await fs.mkdir(join(filesDir, input.taskId), { recursive: true });
    await fs.writeFile(absPath, input.data);

    const [row] = ctx.db
      .insert(attachments)
      .values({
        userId: ctx.userId,
        taskId: input.taskId,
        filename: safeName,
        path: relPath,
        mime: input.mime,
        size: input.data.byteLength,
      })
      .returning()
      .all();
    return row!;
  },

  list(ctx: Ctx, taskId: string): AttachmentRecord[] {
    return ctx.db
      .select()
      .from(attachments)
      .where(and(userScope(attachments, ctx.userId), eq(attachments.taskId, taskId)))
      .all();
  },

  /** Resolve a stored row to its bytes' location on disk. */
  get(
    ctx: Ctx,
    id: string,
    opts: { filesDir?: string } = {},
  ): { record: AttachmentRecord; absolutePath: string } {
    const filesDir = opts.filesDir ?? DEFAULT_FILES_DIR;
    const record = ctx.db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, id), userScope(attachments, ctx.userId)))
      .get();
    if (!record) throw new NotFoundError('Attachment', id);
    const absolutePath = isAbsolute(record.path) ? record.path : resolve(filesDir, record.path);
    return { record, absolutePath };
  },

  async remove(ctx: Ctx, id: string, opts: { filesDir?: string } = {}): Promise<void> {
    const { record, absolutePath } = attachmentService.get(ctx, id, opts);
    await fs.rm(absolutePath, { force: true });
    ctx.db
      .delete(attachments)
      .where(and(eq(attachments.id, record.id), userScope(attachments, ctx.userId)))
      .run();
  },
};
