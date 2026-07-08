import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function jsonText(value: unknown): string {
  // `JSON.stringify(undefined)` returns `undefined` (not a string), which fails the
  // SDK's text-content-block validation for void-returning services (e.g.
  // `taskService.remove`, `tagService.attach/detach`). Normalize to `null`.
  return JSON.stringify(value === undefined ? null : value, null, 2);
}

/** Success content block(s) from a service return value. */
export function ok(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: jsonText(value) }] };
}

/** Error content block; MCP surfaces isError to the caller. */
export function fail(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Wrap a tool body so thrown errors (incl. core validation) become isError results. */
export async function guard(fn: () => Promise<unknown> | unknown): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (error) {
    return fail(error);
  }
}
