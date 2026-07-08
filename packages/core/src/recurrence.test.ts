import { describe, it, expect } from 'vitest';
import { isValidRecurrence, assertValidRecurrence, nextOccurrence } from './recurrence';
import { ValidationError } from './errors';

describe('recurrence', () => {
  it('validates a good RRULE', () => {
    expect(isValidRecurrence('FREQ=DAILY')).toBe(true);
    expect(isValidRecurrence('FREQ=WEEKLY;BYDAY=MO,WE')).toBe(true);
  });

  it('rejects garbage', () => {
    expect(isValidRecurrence('not-a-rule')).toBe(false);
    expect(() => assertValidRecurrence('FREQ=NOPE')).toThrow(ValidationError);
  });

  it('computes the next daily occurrence after an anchor (UTC)', () => {
    const after = new Date('2026-01-05T09:00:00Z');
    const next = nextOccurrence('FREQ=DAILY', after);
    expect(next?.toISOString()).toBe('2026-01-06T09:00:00.000Z');
  });

  it('computes the next weekly occurrence', () => {
    // 2026-01-05 is a Monday.
    const after = new Date('2026-01-05T09:00:00Z');
    const next = nextOccurrence('FREQ=WEEKLY;BYDAY=MO', after);
    expect(next?.toISOString()).toBe('2026-01-12T09:00:00.000Z');
  });

  it('returns null when a finite rule is exhausted', () => {
    const after = new Date('2026-01-05T09:00:00Z');
    expect(nextOccurrence('FREQ=DAILY;COUNT=1', after)).toBeNull();
  });
});
