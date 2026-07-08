import { describe, it, expect } from 'vitest';
import { createDb, runMigrations } from '@justdoit/core';
import { createApp } from '../app';

function app() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return createApp(db);
}

describe('tags routes', () => {
  it('creates a tag and returns 409 on duplicate name', async () => {
    const a = app();
    const first = await a.request('/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'errands' }),
    });
    expect(first.status).toBe(201);

    const dup = await a.request('/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'errands' }),
    });
    expect(dup.status).toBe(409);
  });
});
