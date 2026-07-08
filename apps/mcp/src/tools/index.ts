import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Db } from '@justdoit/core';
import { registerTaskTools } from './tasks.js';
import { registerProjectTools } from './projects.js';
import { registerTimeTools } from './time.js';
import { registerMiscTools } from './misc.js';

export function registerTools(server: McpServer, db: Db): void {
  registerTaskTools(server, db);
  registerProjectTools(server, db);
  registerTimeTools(server, db);
  registerMiscTools(server, db);
}
