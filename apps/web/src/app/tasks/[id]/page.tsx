import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { TaskDetail } from '@/components/task-detail';

// Hard-refresh / direct-link fallback for the intercepted drawer route
// (src/app/tasks/@modal/(.)[id]/page.tsx). Same TaskDetail content, rendered
// full-page instead of in a Sheet.
export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 py-2">
      <Link
        href="/tasks"
        className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Back to list
      </Link>
      <TaskDetail taskId={id} />
    </div>
  );
}
