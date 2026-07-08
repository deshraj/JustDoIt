'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useShortcut } from '@/hooks/use-keyboard-shortcuts';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: '⌘K', label: 'Open command palette' },
  { keys: '/', label: 'Focus quick-add' },
  { keys: 'J / K', label: 'Move selection down / up in the list' },
  { keys: '1 / 2 / 3', label: 'Switch List / Board / Calendar view' },
  { keys: '?', label: 'Open this cheatsheet' },
];

/** Maps the `1` / `2` / `3` view-switch shortcuts (advertised above) to routes. */
export const VIEW_SHORTCUT_ROUTES: Record<'1' | '2' | '3', string> = {
  '1': '/tasks',
  '2': '/board',
  '3': '/calendar',
};

export function ShortcutCheatsheet() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  useShortcut('?', () => setOpen(true), { shift: true });
  useShortcut('1', () => router.push(VIEW_SHORTCUT_ROUTES['1']));
  useShortcut('2', () => router.push(VIEW_SHORTCUT_ROUTES['2']));
  useShortcut('3', () => router.push(VIEW_SHORTCUT_ROUTES['3']));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="contents">
              <dt>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {s.keys}
                </kbd>
              </dt>
              <dd className="text-muted-foreground">{s.label}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
