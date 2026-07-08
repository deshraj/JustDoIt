// `rrule`'s CJS build isn't statically analyzable by Node's ESM loader (its
// named exports aren't detected under `import { RRule } from 'rrule'`, which
// crashes real `node`/`tsx` runs with "does not provide an export named
// RRule" even though it works fine under Vitest/bundlers). Import the whole
// CJS module object and destructure at runtime instead — safe everywhere.
import rrulePkg from 'rrule';
import { ValidationError } from './errors';

const { RRule } = rrulePkg;

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
