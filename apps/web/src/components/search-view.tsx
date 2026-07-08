'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { useSearch } from '@/hooks/use-search';
import { TaskRow } from '@/components/task-row';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function SearchView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [input, setInput] = useState(() => searchParams.get('q') ?? '');
  const debounced = useDebouncedValue(input, 300);
  const query = debounced.trim();
  const { data: results, isLoading } = useSearch(query);

  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    if (query) next.set('q', query);
    else next.delete('q');
    router.replace(`${pathname}?${next.toString()}`);
    // Intentionally depend on `query` only: this effect reacts to the
    // debounced query changing, not to the URL it just wrote.
  }, [query]);

  return (
    <div className="flex flex-col gap-6">
      <div className="relative max-w-xl">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          autoFocus
          type="search"
          aria-label="Search tasks"
          placeholder="Search tasks by title or description…"
          className="pl-9 text-base"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </div>

      {!query ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Start typing to search your tasks.
        </p>
      ) : isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : results && results.length > 0 ? (
        <div role="list" aria-label="Search results" className="flex flex-col">
          {results.map((task) => (
            <TaskRow key={task.id} task={task} highlightQuery={query} />
          ))}
        </div>
      ) : (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No tasks match &ldquo;{query}&rdquo;.
        </p>
      )}
    </div>
  );
}
