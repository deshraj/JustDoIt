'use client';

import { Input } from '@/components/ui/input';

/**
 * Styled stub for the top quick-add bar. Wired to POST /quick-add in Task 8
 * (natural-language parsing + keyboard shortcuts); for now it just renders
 * the affordance so the shell reads correctly end to end.
 */
export function QuickAddBar() {
  return (
    <Input
      type="text"
      aria-label="Quick add a task"
      placeholder={'Add a task… try "pay rent friday #home p1"'}
      className="max-w-xl bg-muted/60"
    />
  );
}
