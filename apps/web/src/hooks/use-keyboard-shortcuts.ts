'use client';

import { useEffect } from 'react';

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

/** Registers a global keydown handler, ignoring keystrokes typed into inputs/textareas/contenteditable. */
export function useShortcut(
  key: string,
  handler: () => void,
  opts: { shift?: boolean } = {},
): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      if (opts.shift && !e.shiftKey) return;
      if (e.key !== key) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, handler, opts.shift]);
}
