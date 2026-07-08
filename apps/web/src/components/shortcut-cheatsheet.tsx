'use client';

import { useState } from 'react';
import { useShortcut } from '@/hooks/use-keyboard-shortcuts';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: '⌘K', label: 'Open command palette' },
  { keys: '/', label: 'Focus quick-add' },
  { keys: 'J / K', label: 'Move selection down / up in the list' },
  { keys: '1 / 2 / 3', label: 'Switch List / Board / Calendar view' },
  { keys: '?', label: 'Open this cheatsheet' },
];

export function ShortcutCheatsheet() {
  const [open, setOpen] = useState(false);
  useShortcut('?', () => setOpen(true), { shift: true });

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
