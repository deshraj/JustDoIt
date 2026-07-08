import { describe, it, expect } from 'vitest';
import { freshDb, makeClient } from './helpers.js';

describe('prompts', () => {
  it('lists both prompts', async () => {
    const { client } = await makeClient(freshDb());
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name).sort();
    expect(names).toEqual(['plan_my_day', 'summarize_progress']);
  });

  it('plan_my_day returns a user message', async () => {
    const { client } = await makeClient(freshDb());
    const res = await client.getPrompt({ name: 'plan_my_day', arguments: {} });
    expect(res.messages.length).toBeGreaterThan(0);
    expect(res.messages[0]!.role).toBe('user');
  });

  it('summarize_progress returns a user message', async () => {
    const { client } = await makeClient(freshDb());
    const res = await client.getPrompt({ name: 'summarize_progress', arguments: {} });
    expect(res.messages.length).toBeGreaterThan(0);
    expect(res.messages[0]!.role).toBe('user');
  });
});
