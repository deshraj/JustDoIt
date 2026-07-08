import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createDb, runMigrations, type Db } from '@justdoit/core';
import { createMcpServer } from './server.js';

/**
 * Per-session transport manager.
 *
 * The Streamable HTTP transport is stateful: a single transport instance can
 * only ever be `initialize`d once ("Server already initialized" otherwise). To
 * serve more than one concurrent client we follow the SDK's documented pattern
 * (see `examples/server/simpleStreamableHttp`): keep a `Map<sessionId,
 * transport>`, mint a NEW transport + fresh `McpServer` for each `initialize`
 * request that arrives without a session id, register it under its generated
 * session id, route subsequent requests to it by their `mcp-session-id`, and
 * drop it from the map when the transport closes.
 */
export function createSessionManager(db: Db) {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  async function createTransport(): Promise<StreamableHTTPServerTransport> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        transports.set(sessionId, transport);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };
    // A fresh server per session keeps sessions fully isolated.
    const server = createMcpServer(db);
    await server.connect(transport);
    return transport;
  }

  /**
   * Resolve the transport that should handle a request, or `undefined` if the
   * request is invalid (unknown session id, or a non-initialize request with no
   * session id). A new transport is created for an `initialize` request that
   * carries no session id.
   */
  async function resolve(
    sessionId: string | undefined,
    parsedBody: unknown,
  ): Promise<StreamableHTTPServerTransport | undefined> {
    if (sessionId) return transports.get(sessionId);
    if (isInitializeRequest(parsedBody)) return createTransport();
    return undefined;
  }

  return { transports, resolve, createTransport };
}

export type SessionManager = ReturnType<typeof createSessionManager>;

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Build the HTTP server (not yet listening) so callers/tests control the port
 * and lifecycle. `apiKey` enables the optional bearer / `x-api-key` auth check
 * that runs on every request.
 */
export function createHttpServer(db: Db, opts: { apiKey?: string } = {}): Server {
  const apiKey = opts.apiKey;
  const sessions = createSessionManager(db);

  function authorized(req: IncomingMessage): boolean {
    if (!apiKey) return true; // auth disabled when unset
    const bearer = req.headers['authorization'];
    const header = req.headers['x-api-key'];
    return bearer === `Bearer ${apiKey}` || header === apiKey;
  }

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      if (!authorized(req)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      const header = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(header) ? header[0] : header;

      // Only POST carries a JSON-RPC body (initialize / tool calls); GET (SSE
      // stream) and DELETE (session teardown) route purely by session id.
      const parsedBody = req.method === 'POST' ? await readBody(req) : undefined;
      const transport = await sessions.resolve(sessionId, parsedBody);

      if (!transport) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Bad Request: no valid session' },
            id: null,
          }),
        );
        return;
      }

      await transport.handleRequest(req, res, parsedBody);
    })().catch((err: unknown) => {
      if (!res.headersSent) res.writeHead(500);
      res.end(String(err));
    });
  });
}

// Bootstrap when run as the HTTP entrypoint (skipped when imported by tests).
if (process.env.NODE_ENV !== 'test' && process.env.JUSTDOIT_MCP_NO_LISTEN !== '1') {
  const dbPath = process.env.JUSTDOIT_DB ?? 'justdoit.db';
  const apiKey = process.env.JUSTDOIT_API_KEY; // optional
  const port = Number(process.env.JUSTDOIT_MCP_PORT ?? 3939);

  const { db } = createDb(dbPath);
  runMigrations(db);

  createHttpServer(db, { apiKey }).listen(port, () => {
    process.stderr.write(
      `justdoit MCP (http) on :${port} — db=${dbPath}, auth=${apiKey ? 'on' : 'off'}\n`,
    );
  });
}
