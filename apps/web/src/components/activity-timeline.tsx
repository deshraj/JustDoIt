'use client';

import { useActivity } from '@/hooks/use-activity';
import type { ActivityEntry } from '@/lib/api';

function describeEntry(entry: ActivityEntry): string {
  const p = entry.payload ?? {};
  switch (entry.action) {
    case 'created':
      return 'Created task';
    case 'status_changed':
      return `Changed status to ${String(p.to ?? '?')}`;
    case 'completed':
      return 'Completed task';
    case 'updated':
      return 'Updated task';
    case 'deleted':
      return 'Deleted task';
    default:
      return entry.action.replace(/_/g, ' ');
  }
}

export function ActivityTimeline({ taskId }: { taskId: string }) {
  const { data, isLoading } = useActivity(taskId);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading activity…</p>;
  if (!data?.length) return <p className="text-sm text-muted-foreground">No activity yet.</p>;

  return (
    <ol className="space-y-2" aria-label="Activity timeline">
      {data.map((entry) => (
        <li key={entry.id} className="flex items-baseline gap-2 text-sm">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden />
          <span>{describeEntry(entry)}</span>
          <time
            className="ml-auto shrink-0 text-xs text-muted-foreground"
            dateTime={entry.createdAt.toISOString()}
          >
            {entry.createdAt.toLocaleString()}
          </time>
        </li>
      ))}
    </ol>
  );
}
