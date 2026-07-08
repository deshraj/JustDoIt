'use client';

import { Button } from '@/components/ui/button';

export function Onboarding({
  onQuickAdd,
  onCreateSample,
}: {
  onQuickAdd: () => void;
  onCreateSample: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="text-5xl" aria-hidden>
        ✅
      </div>
      <h1 className="text-2xl font-semibold">Welcome to justdoit</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Capture tasks in plain language, organize with projects &amp; tags, track time, and let your
        agent help. Try typing{' '}
        <code className="rounded bg-muted px-1">buy milk tomorrow 5pm #errands p1</code>.
      </p>
      <div className="flex gap-2">
        <Button onClick={onQuickAdd}>Add your first task</Button>
        <Button variant="secondary" onClick={onCreateSample}>
          Create a sample project
        </Button>
      </div>
    </div>
  );
}
