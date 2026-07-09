import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '@justdoit/mcp';
import type { AppEnv } from '../context';

const badSession = () =>
  Response.json(
    { jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: no valid session' }, id: null },
    { status: 400 },
  );

/**
 * Key-gated MCP streamable-HTTP route. Identity is already resolved by
 * `resolveUser` (mounted before this router in app.ts): a keyless hosted
 * request 401s before reaching here, and `c.var.ctx.userId` is the
 * `X-API-Key` owner (or `local-user` in local mode).
 *
 * Uses the SDK's Web Standard transport (`Request` in, `Response` out) —
 * this composes naturally with Hono's fetch-based request/response model
 * (works identically under `@hono/node-server` and in `app.request()` tests,
 * with no Node `req`/`res` bridging needed).
 *
 * The Streamable HTTP transport is stateful: a single transport instance can
 * only ever be `initialize`d once. To serve more than one concurrent client,
 * keep a `Map<sessionId, transport>` (the SDK's documented pattern): mint a
 * NEW transport + fresh `McpServer` — bound to this request's resolved
 * `ctx` — for each `initialize` request that arrives without a session id,
 * register it under its generated session id, route subsequent requests to
 * it by their `mcp-session-id` header, and drop it from the map on close.
 */
export function mcpRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

  r.all('/', async (c) => {
    const sessionId = c.req.header('mcp-session-id');

    if (sessionId) {
      const transport = transports.get(sessionId);
      if (!transport) return badSession();
      return transport.handleRequest(c.req.raw);
    }

    // No session id: only a POST `initialize` request may start a new session.
    if (c.req.method !== 'POST') return badSession();
    const body: unknown = await c.req.json().catch(() => undefined);
    if (!isInitializeRequest(body)) return badSession();

    const transport: WebStandardStreamableHTTPServerTransport =
      new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport);
        },
      });
    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };
    const server = createMcpServer(c.var.ctx); // session bound to the resolved user
    await server.connect(transport);
    return transport.handleRequest(c.req.raw, { parsedBody: body });
  });

  return r;
}
