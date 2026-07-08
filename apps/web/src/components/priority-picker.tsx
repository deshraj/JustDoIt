'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PRIORITY_LABELS } from '@/lib/utils';
import type { TaskPriority } from '@/lib/api';

const NONE = 'none';

export function PriorityPicker({
  value,
  onChange,
}: {
  value: TaskPriority | null;
  onChange: (priority: TaskPriority | null) => void;
}) {
  return (
    <Select
      value={value ?? NONE}
      onValueChange={(v) => onChange(v === NONE ? null : (v as TaskPriority))}
    >
      <SelectTrigger aria-label="Priority" className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No priority</SelectItem>
        {Object.entries(PRIORITY_LABELS).map(([v, label]) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
