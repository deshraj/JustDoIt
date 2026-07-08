import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpServer, createSessionManager } from '../http.js';
import { freshDb } from './helpers.js';

function initializeBody() {
  return {
    jsonrpc: '2.0' as const,
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0.0.0' },
    },
  };
}

describe('http session manager', () => {
  it('mints a distinct transport per initialize request (no shared singleton)', async () => {
    const sessions = createSessionManager(freshDb());
    const a = await sessions.resolve(undefined, initializeBody());
    const b = await sessions.resolve(undefined, initializeBody());
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // Two independent initializes must NOT collide on one shared transport.
    expect(a).not.toBe(b);
  });

  it('rejects a non-initialize request with no session id', async () => {
    const sessions = createSessionManager(freshDb());
    const body = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
    expect(await sessions.resolve(undefined, body)).toBeUndefined();
  });

  it('rejects an unknown session id', async () => {
    const sessions = createSessionManager(freshDb());
    expect(await sessions.resolve('does-not-exist', undefined)).toBeUndefined();
  });
});

describe('http server (end-to-end, two clients)', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  });

  it('serves two independent clients that each initialize successfully', async () => {
    server = createHttpServer(freshDb());
    await new Promise<void>((r) => server!.listen(0, r));
    const { port } = server.address() as AddressInfo;
    const url = new URL(`http://127.0.0.1:${port}/`);

    const clientA = new Client({ name: 'a', version: '0.0.0' });
    const clientB = new Client({ name: 'b', version: '0.0.0' });
    // A single shared transport would reject the SECOND initialize with
    // "Server already initialized"; both must succeed with distinct sessions.
    await clientA.connect(new StreamableHTTPClientTransport(url));
    await clientB.connect(new StreamableHTTPClientTransport(url));

    const toolsA = await clientA.listTools();
    const toolsB = await clientB.listTools();
    expect(toolsA.tools.length).toBeGreaterThan(0);
    expect(toolsB.tools.length).toBeGreaterThan(0);

    await clientA.close();
    await clientB.close();
  });

  it('enforces the optional api key on every request', async () => {
    server = createHttpServer(freshDb(), { apiKey: 'secret' });
    await new Promise<void>((r) => server!.listen(0, r));
    const { port } = server.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(initializeBody()),
    });
    expect(res.status).toBe(401);

    const ok = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-api-key': 'secret',
      },
      body: JSON.stringify(initializeBody()),
    });
    expect(ok.status).toBe(200);
  });
});
