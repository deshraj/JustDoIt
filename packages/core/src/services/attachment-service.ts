import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { attachments, tasks, type AttachmentRow } from '../db/schema';
import { NotFoundError, ValidationError } from '../errors';

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

export const attachmentService = {
  async add(
    db: Db,
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
    const task = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, input.taskId)).get();
    if (!task) throw new NotFoundError('Task', input.taskId);

    const safeName = sanitize(input.filename);
    const storedName = `${randomUUID()}${extname(safeName)}`;
    const relPath = join(input.taskId, storedName);
    const absPath = join(filesDir, relPath);
    await fs.mkdir(join(filesDir, input.taskId), { recursive: true });
    await fs.writeFile(absPath, input.data);

    const [row] = db
      .insert(attachments)
      .values({
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

  list(db: Db, taskId: string): AttachmentRecord[] {
    return db.select().from(attachments).where(eq(attachments.taskId, taskId)).all();
  },

  /** Resolve a stored row to its bytes' location on disk. */
  get(
    db: Db,
    id: string,
    opts: { filesDir?: string } = {},
  ): { record: AttachmentRecord; absolutePath: string } {
    const filesDir = opts.filesDir ?? DEFAULT_FILES_DIR;
    const record = db.select().from(attachments).where(eq(attachments.id, id)).get();
    if (!record) throw new NotFoundError('Attachment', id);
    const absolutePath = isAbsolute(record.path) ? record.path : resolve(filesDir, record.path);
    return { record, absolutePath };
  },

  async remove(db: Db, id: string, opts: { filesDir?: string } = {}): Promise<void> {
    const { record, absolutePath } = attachmentService.get(db, id, opts);
    await fs.rm(absolutePath, { force: true });
    db.delete(attachments).where(eq(attachments.id, record.id)).run();
  },
};
