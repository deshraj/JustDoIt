import { describe, it, expect } from 'vitest';
import { events, emit } from '@justdoit/core';
import { eventsRoutes } from './events';

describe('GET /events (SSE)', () => {
  it('streams a published domain event as an SSE data frame', async () => {
    events.reset();
    const app = eventsRoutes();
    const res = await app.request('/events');
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // Publish after the stream is open so the subscriber is attached.
    setTimeout(() => emit('task', 't1', 'updated', { patch: { title: 'new' } }, 1), 10);

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
});
