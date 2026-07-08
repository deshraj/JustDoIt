import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createDb, runMigrations } from '@justdoit/core';
import { createMcpServer } from './server.js';

const dbPath = process.env.JUSTDOIT_DB ?? 'justdoit.db';
const apiKey = process.env.JUSTDOIT_API_KEY; // optional
const port = Number(process.env.JUSTDOIT_MCP_PORT ?? 3939);

const { db } = createDb(dbPath);
runMigrations(db);

function authorized(req: import('node:http').IncomingMessage): boolean {
  if (!apiKey) return true; // auth disabled when unset
  const bearer = req.headers['authorization'];
  const header = req.headers['x-api-key'];
  return bearer === `Bearer ${apiKey}` || header === apiKey;
}

const server = createMcpServer(db);
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});
await server.connect(transport);

const http = createServer((req, res) => {
  if (!authorized(req)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  transport.handleRequest(req, res).catch((err: unknown) => {
    res.writeHead(500);
    res.end(String(err));
  });
});

http.listen(port, () => {
  process.stderr.write(
    `justdoit MCP (http) on :${port} — db=${dbPath}, auth=${apiKey ? 'on' : 'off'}\n`,
  );
});
