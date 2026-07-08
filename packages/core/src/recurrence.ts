import { RRule } from 'rrule';
import { ValidationError } from './errors';

export function isValidRecurrence(rule: string): boolean {
  try {
    new RRule(RRule.parseString(rule));
    return true;
  } catch {
    return false;
  }
}

export function assertValidRecurrence(rule: string): void {
  if (!isValidRecurrence(rule)) {
    throw new ValidationError(`Invalid recurrence rule: ${rule}`);
  }
}

export function nextOccurrence(rule: string, after: Date): Date | null {
  const options = RRule.parseString(rule);
  // Anchor the pattern at `after` so the result is deterministic and
  // independent of the current wall clock.
  options.dtstart = after;
  const rrule = new RRule(options);
  return rrule.after(after, false);
}
