'use client';

import { useRef } from 'react';
import { apiUrl } from '@/lib/api';
import { useAttachments, useUploadAttachment, useDeleteAttachment } from '@/hooks/use-attachments';
import { Button } from '@/components/ui/button';

function humanSize(bytes: number | null): string {
  if (!bytes) return '';
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

export function AttachmentsPanel({ taskId }: { taskId: string }) {
  const { data = [], isLoading } = useAttachments(taskId);
  const upload = useUploadAttachment(taskId);
  const remove = useDeleteAttachment(taskId);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <section aria-label="Attachments" className="space-y-2">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading attachments…</p>
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No attachments yet.</p>
      ) : (
        <ul className="space-y-1">
          {data.map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-sm">
              <a
                className="truncate underline"
                href={apiUrl(`/attachments/${a.id}`)}
                target="_blank"
                rel="noreferrer"
              >
                {a.filename}
              </a>
              <span className="shrink-0 text-xs text-muted-foreground">{humanSize(a.size)}</span>
              <button
                type="button"
                aria-label={`Delete ${a.filename}`}
                className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => remove.mutate(a.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <label>
        <span className="sr-only">Add attachment</span>
        <input
          ref={inputRef}
          type="file"
          aria-label="Add attachment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = '';
          }}
        />
      </label>
      <Button
        size="sm"
        variant="secondary"
        disabled={upload.isPending}
        onClick={() => inputRef.current?.click()}
      >
        {upload.isPending ? 'Uploading…' : 'Add attachment'}
      </Button>
    </section>
  );
}
