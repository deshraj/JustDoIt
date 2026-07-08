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

  it('matches BYDAY against LOCAL wall-clock, not UTC, for evening anchors', () => {
    // Monday 2026-01-05 at 21:00 LOCAL time. In a western timezone (e.g. US
    // Eastern/Pacific) this instant falls on Tuesday in UTC, so UTC-based BYDAY
    // matching would drift the next MO to +6 days landing on a Sunday locally.
    const anchor = new Date(2026, 0, 5, 21, 0, 0); // local Monday 9pm
    expect(anchor.getDay()).toBe(1); // sanity: Monday in local time
    const next = nextOccurrence('FREQ=WEEKLY;BYDAY=MO', anchor);
    expect(next).not.toBeNull();
    // Next weekly Monday is exactly +7 days later and still a Monday locally.
    const deltaDays = (next!.getTime() - anchor.getTime()) / (24 * 60 * 60 * 1000);
    expect(deltaDays).toBe(7);
    expect(next!.getDay()).toBe(1);
  });
});
