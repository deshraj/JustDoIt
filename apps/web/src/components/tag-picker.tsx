'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useAttachTag, useCreateTag, useDetachTag, useTags, useTaskTags } from '@/hooks/use-tags';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function TagPicker({ taskId }: { taskId: string }) {
  const { data: allTags } = useTags();
  const { data: taskTags } = useTaskTags(taskId);
  const createTag = useCreateTag();
  const attach = useAttachTag(taskId);
  const detach = useDetachTag(taskId);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const attachedIds = new Set((taskTags ?? []).map((t) => t.id));
  const suggestions = (allTags ?? []).filter(
    (t) => !attachedIds.has(t.id) && t.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const exactMatch = (allTags ?? []).some(
    (t) => t.name.toLowerCase() === query.trim().toLowerCase(),
  );

  async function createAndAttach(): Promise<void> {
    const name = query.trim();
    if (!name) return;
    const tag = await createTag.mutateAsync(name);
    attach.mutate(tag.id);
    setQuery('');
    setOpen(false);
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tags</h3>
      <div className="flex flex-wrap items-center gap-1.5">
        {(taskTags ?? []).map((tag) => (
          <Badge key={tag.id} variant="secondary" className="gap-1 pr-1">
            {tag.name}
            <button
              type="button"
              aria-label={`Remove tag ${tag.name}`}
              className="rounded-full p-0.5 transition-colors duration-150 ease-out hover:bg-foreground/10"
              onClick={() => detach.mutate(tag.id)}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs">
              <Plus className="size-3" />
              Add tag
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-48">
            <div className="px-1 pb-1">
              <Input
                autoFocus
                aria-label="Search or create a tag"
                placeholder="Search or create…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && suggestions.length === 0 && !exactMatch) {
                    e.preventDefault();
                    void createAndAttach();
                  }
                }}
                className="h-7 text-xs"
              />
            </div>
            {suggestions.map((tag) => (
              <DropdownMenuItem
                key={tag.id}
                onSelect={() => {
                  attach.mutate(tag.id);
                  setQuery('');
                }}
              >
                {tag.name}
              </DropdownMenuItem>
            ))}
            {query.trim() && !exactMatch && (
              <DropdownMenuItem onSelect={() => void createAndAttach()}>
                Create &ldquo;{query.trim()}&rdquo;
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </section>
  );
}
