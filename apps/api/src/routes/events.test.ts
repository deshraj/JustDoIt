import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { createDb, events, emit, LOCAL_USER_ID } from '@justdoit/core';
import { eventsRoutes } from './events';
import type { AppEnv } from '../context';

/** Mount `eventsRoutes()` behind a fixed-identity ctx middleware, for testing the
 * per-user SSE filter in isolation from the real `setUserContext` resolution. */
function appAs(userId: string) {
  const { db } = createDb(':memory:');
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('ctx', { db, userId });
    return next();
  });
  app.route('/', eventsRoutes());
  return app;
}

describe('GET /events (SSE)', () => {
  it('streams a published domain event as an SSE data frame', async () => {
    events.reset();
    const app = appAs(LOCAL_USER_ID);
    const res = await app.request('/events');
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Publish after the stream is open so the subscriber is attached.
    setTimeout(
      () => emit(LOCAL_USER_ID, 'task', 't1', 'updated', { patch: { title: 'new' } }, 1),
      10,
    );

    let buf = '';
    while (!buf.includes('task.updated')) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    expect(buf).toContain('data:');
    expect(buf).toContain('"entityId":"t1"');
  });

  it('filters events by the acting user — A never receives B events', async () => {
    events.reset();
    const appA = appAs('user-a');
    const res = await appA.request('/events');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    setTimeout(() => {
      emit('user-b', 'task', 'b-task', 'updated', {}, 1); // A must not see this
      emit('user-a', 'task', 'a-task', 'updated', {}, 2); // A's own event
    }, 10);

    let buf = '';
    while (!buf.includes('"entityId":"a-task"')) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
    expect(buf).toContain('"entityId":"a-task"');
    expect(buf).not.toContain('"entityId":"b-task"');
  });
});
