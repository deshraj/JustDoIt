import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Db } from '@justdoit/core';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';

export function createMcpServer(db: Db): McpServer {
  const server = new McpServer({
    name: 'justdoit',
    version: '0.0.0',
  });

  registerTools(server, db);
  registerResources(server, db);
  registerPrompts(server);

  return server;
}
