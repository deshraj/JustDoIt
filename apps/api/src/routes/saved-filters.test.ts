import { describe, it, expect } from 'vitest';
import { createDb, runMigrations } from '@justdoit/core';
import { createApp } from '../app';

interface SavedFilterJson {
  id: string;
  name: string;
  query: Record<string, unknown>;
}

function harness() {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return createApp(db);
}

describe('/saved-filters', () => {
  it('creates and lists saved filters', async () => {
    const app = harness();
    const create = await app.request('/saved-filters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Today', query: { due: 'today' } }),
    });
    expect(create.status).toBe(201);
    const { savedFilter } = (await create.json()) as { savedFilter: SavedFilterJson };
    expect(savedFilter.name).toBe('Today');

    const list = await app.request('/saved-filters');
    const body = (await list.json()) as { savedFilters: SavedFilterJson[] };
    expect(body.savedFilters).toHaveLength(1);
  });

  it('400s on empty name and 404s on unknown id delete', async () => {
    const app = harness();
    const bad = await app.request('/saved-filters', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', query: {} }),
    });
    expect(bad.status).toBe(400);
    const del = await app.request('/saved-filters/nope', { method: 'DELETE' });
    expect(del.status).toBe(404);
  });
});
