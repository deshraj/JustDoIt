'use client';

import { useBulkUpdateTasks, useBulkDeleteTasks } from '@/hooks/use-bulk-tasks';
import type { BulkTaskPatch } from '@/lib/api';
import { Button } from '@/components/ui/button';

export function BulkActionToolbar({
  selectedIds,
  onDone,
}: {
  selectedIds: string[];
  onDone: () => void;
}) {
  const update = useBulkUpdateTasks();
  const remove = useBulkDeleteTasks();

  if (selectedIds.length === 0) return null;

  function patch(p: BulkTaskPatch): void {
    update.mutate({ ids: selectedIds, patch: p }, { onSuccess: onDone });
  }

  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="fixed bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background px-4 py-2 shadow-lg"
    >
      <span className="text-sm font-medium">{selectedIds.length} selected</span>
      <Button size="sm" variant="secondary" onClick={() => patch({ status: 'done' })}>
        Mark done
      </Button>
      <Button size="sm" variant="secondary" onClick={() => patch({ priority: 'p1' })}>
        Set P1
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => remove.mutate(selectedIds, { onSuccess: onDone })}
      >
        Delete
      </Button>
    </div>
  );
}
