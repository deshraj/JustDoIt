'use client';

import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { Sidebar } from '@/components/sidebar';
import { QuickAddBar } from '@/components/quick-add-bar';
import { ThemeToggle } from '@/components/theme-toggle';
import { CommandPalette } from '@/components/command-palette';
import { useCommandPalette } from '@/hooks/use-command-palette';
import { Button } from '@/components/ui/button';

/**
 * Minimal, near-borderless shell: fixed sidebar + top bar + content region.
 * Regions are separated by whitespace and a subtle bg-muted elevation on the
 * sidebar rather than 1px border lines, per the design system.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { open, setOpen } = useCommandPalette();

  return (
    <div className="flex h-dvh bg-background text-foreground">
      <div className="hidden shrink-0 bg-muted/40 md:block">
        <Sidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 px-6 py-4 md:px-8">
          <QuickAddBar />
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open command palette"
              onClick={() => setOpen(true)}
            >
              <Search className="size-4" aria-hidden="true" />
            </Button>
            <ThemeToggle />
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 md:px-8">{children}</main>
      </div>
      <CommandPalette open={open} onOpenChange={setOpen} />
    </div>
  );
}
