import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Ctx } from '@justdoit/core';
import { registerTools } from './tools/index.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';

export function createMcpServer(ctx: Ctx): McpServer {
  const server = new McpServer({ name: 'justdoit', version: '0.0.0' });
  registerTools(server, ctx);
  registerResources(server, ctx);
  registerPrompts(server);
  return server;
}
