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
  // rrule matches BYDAY/BYMONTHDAY against a date's *UTC* calendar fields, but our
  // anchors are absolute instants whose meaningful weekday/day-of-month is the LOCAL
  // wall-clock one. For an evening task in a western timezone the local weekday and the
  // UTC weekday differ, so anchoring rrule on the raw instant drifts the match to the
  // wrong day (e.g. a Monday-evening task lands on Sunday, +6 days instead of +7).
  //
  // Fix: build a synthetic UTC instant whose UTC fields equal the anchor's LOCAL fields,
  // run rrule in that "local-as-UTC" space (where UTC has no DST and the weekday is the
  // local one), then translate the resulting step back onto the real instant.
  const localAsUtc = new Date(
    Date.UTC(
      after.getFullYear(),
      after.getMonth(),
      after.getDate(),
      after.getHours(),
      after.getMinutes(),
      after.getSeconds(),
      after.getMilliseconds(),
    ),
  );
  options.dtstart = localAsUtc;
  const rrule = new RRule(options);
  const next = rrule.after(localAsUtc, false);
  if (!next) return null;
  // The offset from the (local) anchor to the next occurrence, measured in the DST-free
  // local-as-UTC space, applied back to the real anchor instant.
  return new Date(after.getTime() + (next.getTime() - localAsUtc.getTime()));
}
