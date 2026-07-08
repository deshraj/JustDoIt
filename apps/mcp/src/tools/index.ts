import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Db } from '@justdoit/core';
import { registerTaskTools } from './tasks.js';

export function registerTools(server: McpServer, db: Db): void {
  registerTaskTools(server, db);
}
