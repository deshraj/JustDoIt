'use client';

import { useState } from 'react';
import {
  useSavedFilters,
  useCreateSavedFilter,
  useDeleteSavedFilter,
} from '@/hooks/use-saved-filters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function SavedFiltersMenu({
  current,
  onApply,
}: {
  current: Record<string, unknown>;
  onApply: (query: Record<string, unknown>) => void;
}) {
  const { data: filters = [] } = useSavedFilters();
  const create = useCreateSavedFilter();
  const remove = useDeleteSavedFilter();
  const [name, setName] = useState('');

  function saveCurrentView(): void {
    const trimmed = name.trim();
    if (!trimmed || create.isPending) return;
    create.mutate({ name: trimmed, query: current }, { onSuccess: () => setName('') });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1" aria-label="Saved views">
        {filters.map((f) => (
          <span key={f.id} className="inline-flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => onApply(f.query)}>
              {f.name}
            </Button>
            <button
              type="button"
              aria-label={`Delete ${f.name}`}
              onClick={() => remove.mutate(f.id)}
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          className="h-8 max-w-48 text-sm"
          placeholder="Save current view…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveCurrentView();
          }}
          aria-label="Saved view name"
        />
        <Button
          type="button"
          size="sm"
          disabled={!name.trim() || create.isPending}
          onClick={saveCurrentView}
        >
          Save view
        </Button>
      </div>
    </div>
  );
}
