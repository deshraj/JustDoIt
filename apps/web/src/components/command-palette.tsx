'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  CalendarDays,
  KanbanSquare,
  ListTodo,
  Moon,
  Plus,
  Search as SearchIcon,
  Sun,
} from 'lucide-react';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';

const VIEW_LINKS = [
  { href: '/tasks', label: 'List', icon: ListTodo },
  { href: '/board', label: 'Board', icon: KanbanSquare },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/search', label: 'Search', icon: SearchIcon },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
] as const;

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = useState('');

  const { data: tasks } = useQuery({
    queryKey: qk.tasks.list({}),
    queryFn: () => api.listTasks({}),
    enabled: open,
  });
  const { data: projects } = useQuery({
    queryKey: qk.projects.all,
    queryFn: () => api.listProjects(),
    enabled: open,
  });

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  function go(href: string): void {
    router.push(href);
    onOpenChange(false);
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search tasks, jump to a view…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {VIEW_LINKS.map(({ href, label, icon: Icon }) => (
            <CommandItem key={href} value={label} onSelect={() => go(href)}>
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </CommandItem>
          ))}
          {projects?.map((project) => (
            <CommandItem
              key={project.id}
              value={`Project: ${project.name}`}
              onSelect={() => go(`/tasks?project=${project.id}`)}
            >
              {project.name}
            </CommandItem>
          ))}
          {tasks?.slice(0, 50).map((task) => (
            <CommandItem key={task.id} value={task.title} onSelect={() => go(`/tasks/${task.id}`)}>
              {task.title}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem
            value="Toggle theme"
            onSelect={() => {
              setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
              onOpenChange(false);
            }}
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="size-4" aria-hidden="true" />
            ) : (
              <Moon className="size-4" aria-hidden="true" />
            )}
            Toggle theme
          </CommandItem>
          <CommandItem
            value="New task"
            onSelect={() => {
              onOpenChange(false);
              document.querySelector<HTMLInputElement>('[aria-label="Quick add a task"]')?.focus();
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New task
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
