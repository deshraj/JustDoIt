import cron, { type ScheduledTask } from 'node-cron';
import notifier from 'node-notifier';
import { reminderService, taskService, type Db } from '@justdoit/core';

export interface Notifier {
  notify(input: { title: string; message: string }): void;
}

export const desktopNotifier: Notifier = {
  notify({ title, message }) {
    notifier.notify({ title, message });
  },
};

export function runReminderTick(db: Db, notify: Notifier, now: Date): number {
  const due = reminderService.dueReminders(db, now);
  for (const reminder of due) {
    const ctx = { db, userId: reminder.userId };
    const task = taskService.get(ctx, reminder.taskId);
    notify.notify({ title: 'justdoit', message: task.title });
    reminderService.markDelivered(ctx, reminder.id);
  }
  return due.length;
}

export interface SchedulerOptions {
  db: Db;
  notifier?: Notifier;
  now?: () => Date;
  schedule?: string;
}

export function startReminderScheduler(opts: SchedulerOptions): ScheduledTask {
  const {
    db,
    notifier: n = desktopNotifier,
    now = () => new Date(),
    schedule = '* * * * *',
  } = opts;
  return cron.schedule(schedule, () => {
    runReminderTick(db, n, now());
  });
}
