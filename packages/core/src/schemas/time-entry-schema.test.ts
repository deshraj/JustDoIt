import { describe, it, expect } from 'vitest';
import { logManualSchema, updateEntrySchema, timeEntryFilterSchema } from './time-entry-schema';

describe('logManualSchema', () => {
  it('accepts an explicit endedAt and coerces ISO strings to Date', () => {
    const parsed = logManualSchema.parse({
      taskId: '11111111-1111-4111-8111-111111111111',
      startedAt: '2026-07-08T09:00:00.000Z',
      endedAt: '2026-07-08T10:00:00.000Z',
    });
    expect(parsed.startedAt).toBeInstanceOf(Date);
    expect(parsed.endedAt).toBeInstanceOf(Date);
  });

  it('accepts an explicit durationSeconds', () => {
    const parsed = logManualSchema.parse({
      taskId: '11111111-1111-4111-8111-111111111111',
      startedAt: '2026-07-08T09:00:00.000Z',
      durationSeconds: 1800,
    });
    expect(parsed.durationSeconds).toBe(1800);
  });

  it('rejects when neither endedAt nor durationSeconds is present', () => {
    expect(() =>
      logManualSchema.parse({
        taskId: '11111111-1111-4111-8111-111111111111',
        startedAt: '2026-07-08T09:00:00.000Z',
      }),
    ).toThrow();
  });

  it('rejects when BOTH endedAt and durationSeconds are present', () => {
    expect(() =>
      logManualSchema.parse({
        taskId: '11111111-1111-4111-8111-111111111111',
        startedAt: '2026-07-08T09:00:00.000Z',
        endedAt: '2026-07-08T10:00:00.000Z',
        durationSeconds: 1800,
      }),
    ).toThrow();
  });

  it('rejects endedAt earlier than startedAt', () => {
    expect(() =>
      logManualSchema.parse({
        taskId: '11111111-1111-4111-8111-111111111111',
        startedAt: '2026-07-08T10:00:00.000Z',
        endedAt: '2026-07-08T09:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('updateEntrySchema', () => {
  it('allows a partial patch', () => {
    expect(updateEntrySchema.parse({ note: 'refactor' })).toEqual({ note: 'refactor' });
  });

  it('allows nulling a field', () => {
    expect(updateEntrySchema.parse({ note: null })).toEqual({ note: null });
  });

  it('rejects an empty patch', () => {
    expect(() => updateEntrySchema.parse({})).toThrow();
  });
});

describe('timeEntryFilterSchema', () => {
  it('maps snake_case query params to a camelCase filter', () => {
    const parsed = timeEntryFilterSchema.parse({
      task_id: '11111111-1111-4111-8111-111111111111',
      project_id: '22222222-2222-4222-8222-222222222222',
      running: 'true',
      limit: '25',
    });
    expect(parsed).toMatchObject({
      taskId: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      running: true,
      limit: 25,
    });
  });

  it('parses running=false correctly (not a truthy string coercion)', () => {
    expect(timeEntryFilterSchema.parse({ running: 'false' }).running).toBe(false);
  });
});
