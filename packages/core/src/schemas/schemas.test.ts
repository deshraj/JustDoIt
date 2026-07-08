import { describe, it, expect } from 'vitest';
import {
  createTaskSchema,
  updateTaskSchema,
  setStatusSchema,
  createProjectSchema,
  createTagSchema,
  quickAddSchema,
} from './index';
import { NotFoundError, ValidationError, ConflictError } from '../errors';

describe('errors', () => {
  it('NotFoundError carries entity + id in the message', () => {
    const err = new NotFoundError('Task', 'abc');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NotFoundError');
    expect(err.message).toContain('Task');
    expect(err.message).toContain('abc');
  });

  it('ValidationError and ConflictError set their names', () => {
    expect(new ValidationError('bad').name).toBe('ValidationError');
    expect(new ConflictError('dup').name).toBe('ConflictError');
  });
});

describe('task schemas', () => {
  it('requires a non-empty title', () => {
    expect(createTaskSchema.safeParse({ title: '' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'ok' }).success).toBe(true);
  });

  it('coerces an ISO due date string to a Date', () => {
    const parsed = createTaskSchema.parse({ title: 't', dueAt: '2026-07-09T17:00:00.000Z' });
    expect(parsed.dueAt).toBeInstanceOf(Date);
  });

  it('rejects an unknown priority', () => {
    expect(createTaskSchema.safeParse({ title: 't', priority: 'p9' }).success).toBe(false);
  });

  it('setStatusSchema only accepts known statuses', () => {
    expect(setStatusSchema.safeParse({ status: 'done' }).success).toBe(true);
    expect(setStatusSchema.safeParse({ status: 'nope' }).success).toBe(false);
  });

  it('updateTaskSchema allows a partial patch', () => {
    expect(updateTaskSchema.safeParse({}).success).toBe(true);
    expect(updateTaskSchema.safeParse({ archived: true }).success).toBe(true);
  });
});

describe('project / tag / quick-add schemas', () => {
  it('project and tag require a name', () => {
    expect(createProjectSchema.safeParse({ name: '' }).success).toBe(false);
    expect(createTagSchema.safeParse({ name: 'errands' }).success).toBe(true);
  });

  it('quickAddSchema requires non-empty text', () => {
    expect(quickAddSchema.safeParse({ text: '' }).success).toBe(false);
    expect(quickAddSchema.safeParse({ text: 'buy milk tomorrow' }).success).toBe(true);
  });
});
