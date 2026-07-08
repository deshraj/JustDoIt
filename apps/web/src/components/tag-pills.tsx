import type { Tag } from '@/lib/api';

/**
 * Small, minimal tag pills for List rows and Board cards — tags were
 * otherwise only visible inside the task detail drawer's TagPicker.
 * Deliberately terse (a color dot + name) to stay out of the way at a
 * glance; the drawer remains the place to manage tags.
 */
export function TagPills({ tags }: { tags: Tag[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="inline-flex max-w-24 items-center gap-1 truncate rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
        >
          <span
            className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
            style={tag.color ? { backgroundColor: tag.color } : undefined}
            aria-hidden="true"
          />
          <span className="truncate">{tag.name}</span>
        </span>
      ))}
    </div>
  );
}
