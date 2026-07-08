import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { projects, tags, type Task, type TaskPriority } from '../db/schema';
import { ValidationError } from '../errors';
import { projectService } from './project-service';
import { tagService } from './tag-service';
import { taskService } from './task-service';

export interface QuickAddParsed {
  title: string;
  dueAt?: Date;
  priority?: TaskPriority;
  tags: string[];
  projectName?: string;
}

const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

interface TimeOfDay {
  hours: number;
  minutes: number;
}

function parseTime(token: string): TimeOfDay | undefined {
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(token);
  if (!m) return undefined;
  const hasColon = m[2] !== undefined;
  const meridiem = m[3];
  // A bare integer (e.g. "5") is NOT a time; require am/pm or a colon.
  if (!hasColon && !meridiem) return undefined;
  let hours = Number.parseInt(m[1]!, 10);
  const minutes = hasColon ? Number.parseInt(m[2]!, 10) : 0;
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return undefined;
  return { hours, minutes };
}

function computeDueAt(
  now: Date,
  dateWord: string | undefined,
  time: TimeOfDay | undefined,
): Date | undefined {
  if (!dateWord && !time) return undefined;
  const d = new Date(now);
  d.setSeconds(0, 0);
  if (dateWord === 'tomorrow') {
    d.setDate(d.getDate() + 1);
  } else if (dateWord && dateWord !== 'today') {
    const target = WEEKDAYS.indexOf(dateWord as (typeof WEEKDAYS)[number]);
    let diff = (target - d.getDay() + 7) % 7;
    if (diff === 0) diff = 7; // "monday" on a Monday means next Monday
    d.setDate(d.getDate() + diff);
  }
  if (time) {
    d.setHours(time.hours, time.minutes, 0, 0);
  } else {
    d.setHours(9, 0, 0, 0);
  }
  return d;
}

export function parseQuickAdd(text: string, now: Date = new Date()): QuickAddParsed {
  const tagsFound: string[] = [];
  let priority: TaskPriority | undefined;
  let projectName: string | undefined;
  let dateWord: string | undefined;
  let time: TimeOfDay | undefined;
  const titleParts: string[] = [];

  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    if (token.length > 1 && token.startsWith('#')) {
      tagsFound.push(token.slice(1));
      continue;
    }
    if (token.length > 1 && token.startsWith('@')) {
      projectName = token.slice(1);
      continue;
    }
    if (/^p[0-3]$/i.test(token)) {
      priority = token.toLowerCase() as TaskPriority;
      continue;
    }
    const lower = token.toLowerCase();
    if (lower === 'today' || lower === 'tomorrow' || WEEKDAYS.includes(lower as never)) {
      dateWord = lower;
      continue;
    }
    const t = parseTime(lower);
    if (t) {
      time = t;
      continue;
    }
    titleParts.push(token);
  }

  return {
    title: titleParts.join(' '),
    dueAt: computeDueAt(now, dateWord, time),
    priority,
    tags: tagsFound,
    projectName,
  };
}

export const quickAddService = {
  parse(text: string, now: Date = new Date()): QuickAddParsed {
    return parseQuickAdd(text, now);
  },

  create(db: Db, text: string, now: Date = new Date()): Task {
    const parsed = parseQuickAdd(text, now);
    if (!parsed.title) throw new ValidationError('Quick-add text produced an empty title');

    let projectId: string | undefined;
    if (parsed.projectName) {
      const existing = db
        .select()
        .from(projects)
        .where(eq(projects.name, parsed.projectName))
        .get();
      projectId = existing
        ? existing.id
        : projectService.create(db, { name: parsed.projectName }).id;
    }

    const task = taskService.create(db, {
      title: parsed.title,
      priority: parsed.priority ?? null,
      projectId: projectId ?? null,
      dueAt: parsed.dueAt ?? null,
    });

    for (const name of parsed.tags) {
      const existing = db.select().from(tags).where(eq(tags.name, name)).get();
      const tag = existing ?? tagService.create(db, { name });
      tagService.attach(db, task.id, tag.id);
    }

    return taskService.get(db, task.id);
  },
};
