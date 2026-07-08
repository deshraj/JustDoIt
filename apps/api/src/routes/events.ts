import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { events, type DomainEvent } from '@justdoit/core';

/**
 * SSE fan-out of the in-process domain event bus. No `db` dependency — this
 * route only relays events already published to the (single-process)
 * `events` singleton; see the Phase 6 plan's documented cross-process
 * limitation (the MCP server's mutations never reach these browser clients).
 */
export function eventsRoutes(): Hono {
  const r = new Hono();

  r.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      // Queue events and drain them so we never write concurrently to the stream.
      const queue: DomainEvent[] = [];
      let notify: (() => void) | null = null;
      const off = events.subscribe((event) => {
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
    }),
  );

  return r;
}
