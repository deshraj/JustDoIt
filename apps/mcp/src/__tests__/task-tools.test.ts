import { describe, it, expect } from 'vitest';
import { freshDb, makeClient } from './helpers.js';

describe('mcp server bootstrap', () => {
  // NOTE: SDK 1.29.0 only installs the `tools/list` request handler once at
  // least one tool has been registered (see `setToolRequestHandlers` in
  // server/mcp.js) — calling `listTools()` before any tool exists throws
  // "Method not found" instead of returning `[]`. So the pre-Task-2 smoke
  // test asserts the connection handshake succeeded via `getServerVersion()`
  // instead of `listTools()`. `listTools()` is exercised for real starting
  // in Task 2's tests (and the "registers all 17 tools" assertion in Task 6).
  it('connects to the server and completes the handshake', async () => {
    const { client } = await makeClient(freshDb());
    expect(client.getServerVersion()).toEqual({ name: 'justdoit', version: '0.0.0' });
  });
});
