import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Db } from '@justdoit/core';
import { registerTools } from './tools/index.js';

export function createMcpServer(db: Db): McpServer {
  const server = new McpServer({
    name: 'justdoit',
    version: '0.0.0',
  });

  registerTools(server, db);
  // registerResources(server, db); // Task 7
  // registerPrompts(server);       // Task 8

  return server;
}
