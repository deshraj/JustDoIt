'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useQuickAdd } from '@/hooks/use-quick-add';

/** Custom event name other components (e.g. the onboarding CTA) dispatch to
 * focus the quick-add bar without needing a ref threaded through the tree. */
const FOCUS_EVENT = 'justdoit:focus-quick-add';

export function focusQuickAdd(): void {
  window.dispatchEvent(new Event(FOCUS_EVENT));
}

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
    function onFocusRequest(): void {
      inputRef.current?.focus();
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(FOCUS_EVENT, onFocusRequest);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(FOCUS_EVENT, onFocusRequest);
    };
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
