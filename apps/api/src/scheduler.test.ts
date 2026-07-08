import { describe, it, expect } from 'vitest';
import { createDb, runMigrations, tasks, reminderService } from '@justdoit/core';
import { runReminderTick, type Notifier } from './scheduler';

function setup() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  const [task] = db.insert(tasks).values({ title: 'stand up' }).returning().all();
  return { db, taskId: task!.id };
}

class FakeNotifier implements Notifier {
  sent: { title: string; message: string }[] = [];
  notify(input: { title: string; message: string }): void {
    this.sent.push(input);
  }
}

describe('runReminderTick', () => {
  it('fires + marks due reminders and leaves future ones alone', () => {
    const { db, taskId } = setup();
    const now = new Date('2026-06-01T12:00:00Z');
    const due = reminderService.create(db, { taskId, remindAt: new Date('2026-06-01T11:00:00Z') });
    const future = reminderService.create(db, {
      taskId,
      remindAt: new Date('2026-06-01T13:00:00Z'),
    });
    const notifier = new FakeNotifier();

    const count = runReminderTick(db, notifier, now);

    expect(count).toBe(1);
    expect(notifier.sent).toEqual([{ title: 'justdoit', message: 'stand up' }]);
    expect(reminderService.get(db, due.id).delivered).toBe(true);
    expect(reminderService.get(db, future.id).delivered).toBe(false);
  });

  it('is idempotent — a second tick fires nothing', () => {
    const { db, taskId } = setup();
    const now = new Date('2026-06-01T12:00:00Z');
    reminderService.create(db, { taskId, remindAt: new Date('2026-06-01T11:00:00Z') });
    const notifier = new FakeNotifier();
    runReminderTick(db, notifier, now);
    expect(runReminderTick(db, notifier, now)).toBe(0);
  });
});
