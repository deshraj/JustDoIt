#!/usr/bin/env -S npx tsx
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDb, runMigrations, LOCAL_USER_ID } from '@justdoit/core';
import { createMcpServer } from './server.js';

const dbPath = process.env.JUSTDOIT_DB ?? 'justdoit.db';
const { db } = createDb(dbPath);
runMigrations(db);

const server = createMcpServer({ db, userId: LOCAL_USER_ID });
const transport = new StdioServerTransport();
await server.connect(transport);
// stdio: do not write to stdout; logs go to stderr.
process.stderr.write(`justdoit MCP (stdio) ready — db=${dbPath}\n`);
