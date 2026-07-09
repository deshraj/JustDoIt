import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus, events, type DomainEvent } from './bus';
import { emit } from './emit';

describe('EventBus', () => {
  it('delivers published events to every subscriber and supports unsubscribe', () => {
    const bus = new EventBus();
    const seen: DomainEvent[] = [];
    const off = bus.subscribe((e) => seen.push(e));
    bus.publish({
      type: 'task.created',
      userId: 'u1',
      entityType: 'task',
      entityId: 't1',
      action: 'created',
      at: 1,
    });
    off();
    bus.publish({
      type: 'task.updated',
      userId: 'u1',
      entityType: 'task',
      entityId: 't1',
      action: 'updated',
      at: 2,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.type).toBe('task.created');
  });

  it('isolates a throwing subscriber from the others', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe((e) => seen.push(e.type));
    expect(() =>
      bus.publish({
        type: 'x',
        userId: 'u1',
        entityType: 'task',
        entityId: 'a',
        action: 'updated',
        at: 0,
      }),
    ).not.toThrow();
    expect(seen).toEqual(['x']);
  });
});

describe('emit helper + singleton', () => {
  beforeEach(() => events.reset());

  it('stamps the dotted type and publishes to the singleton bus', () => {
    const seen: DomainEvent[] = [];
    events.subscribe((e) => seen.push(e));
    emit('u1', 'task', 't1', 'status_changed', { from: 'todo', to: 'in_progress' }, 123);
    emit('u1', 'time_entry', 'e1', 'started', undefined, 456);
    expect(seen[0]).toMatchObject({
      type: 'task.status_changed',
      userId: 'u1',
      entityType: 'task',
      entityId: 't1',
      at: 123,
    });
    expect(seen[1]!.type).toBe('time.started');
  });
});
