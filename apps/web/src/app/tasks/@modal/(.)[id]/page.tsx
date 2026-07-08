'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { TaskDetail } from '@/components/task-detail';

export default function InterceptedTaskModal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) router.back();
      }}
    >
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader className="sr-only">
          <SheetTitle>Task details</SheetTitle>
        </SheetHeader>
        <TaskDetail taskId={id} />
      </SheetContent>
    </Sheet>
  );
}
