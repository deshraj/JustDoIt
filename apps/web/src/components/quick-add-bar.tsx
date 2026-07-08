'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useQuickAdd } from '@/hooks/use-quick-add';

/**
 * Natural-language quick-add, wired to POST /quick-add. Enter submits,
 * global "/" focuses the bar (unless another input/textarea already has
 * focus), Escape clears. Empty submit is a no-op.
 */
export function QuickAddBar() {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const quickAdd = useQuickAdd();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== '/') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function submit(): void {
    const text = value.trim();
    if (!text || quickAdd.isPending) return;
    quickAdd.mutate(text, { onSuccess: () => setValue('') });
  }

  return (
    <Input
      ref={inputRef}
      type="text"
      aria-label="Quick add a task"
      placeholder={'Add a task… try "pay rent friday #home p1"'}
      className="max-w-xl bg-muted/60"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        } else if (e.key === 'Escape') {
          setValue('');
        }
      }}
    />
  );
}
