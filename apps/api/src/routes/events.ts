import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { events, type DomainEvent } from '@justdoit/core';
import type { AppEnv } from '../context';

/**
 * SSE fan-out of the in-process domain event bus. No `db` dependency — this
 * route only relays events already published to the (single-process)
 * `events` singleton; see the Phase 6 plan's documented cross-process
 * limitation (the MCP server's mutations never reach these browser clients).
 *
 * Per-user isolation: every domain event carries `userId` (Task 3); this
 * route forwards to the connected client only events whose `userId` matches
 * the acting `c.var.ctx.userId`, so a user's stream never carries another
 * user's changes.
 */
export function eventsRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.get('/events', (c) => {
    const { userId } = c.var.ctx;
    return streamSSE(c, async (stream) => {
      // Queue events and drain them so we never write concurrently to the stream.
      const queue: DomainEvent[] = [];
      let notify: (() => void) | null = null;
      const off = events.subscribe((event) => {
        if (event.userId !== userId) return; // per-user isolation — never leak across tenants
        queue.push(event);
        notify?.();
      });

      const heartbeat = setInterval(() => {
        void stream.writeSSE({ data: '', event: 'ping' }).catch(() => {});
      }, 15_000);

      stream.onAbort(() => {
        off();
        clearInterval(heartbeat);
        notify?.();
      });

      try {
        while (!stream.closed && !stream.aborted) {
          if (queue.length === 0) {
            await new Promise<void>((resolve) => {
              notify = resolve;
            });
            notify = null;
            continue;
          }
          const event = queue.shift();
          if (event) {
            await stream.writeSSE({
              data: JSON.stringify(event),
              event: 'change',
              id: `${event.at}`,
            });
          }
        }
      } finally {
        off();
        clearInterval(heartbeat);
      }
    });
  });

  return r;
}
