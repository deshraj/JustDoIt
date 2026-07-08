// `rrule` ships CJS only (no `exports` map; `main` -> `dist/es5/rrule.js`) and its
// CJS build isn't statically analyzable by Node's cjs-module-lexer, so a named ESM
// import (`import { RRule } from 'rrule'`) fails under plain Node/tsx with
// "does not provide an export named 'RRule'" — it only worked under vitest because
// vite-node's CJS interop doesn't rely on that static analysis. A default import of
// a CJS module always binds to the full `module.exports` object regardless of lexer
// detection, so destructuring from that (a plain runtime property access, not an ES
// import binding) is interop-safe everywhere.
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
