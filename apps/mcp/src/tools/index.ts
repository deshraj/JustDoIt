import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Ctx } from '@justdoit/core';
import { registerTaskTools } from './tasks.js';
import { registerProjectTools } from './projects.js';
import { registerTimeTools } from './time.js';
import { registerMiscTools } from './misc.js';

export function registerTools(server: McpServer, ctx: Ctx): void {
  registerTaskTools(server, ctx);
  registerProjectTools(server, ctx);
  registerTimeTools(server, ctx);
  registerMiscTools(server, ctx);
}
