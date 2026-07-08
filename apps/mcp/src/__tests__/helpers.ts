import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createDb, runMigrations, type Db } from '@justdoit/core';
import { createMcpServer } from '../server.js';

export function freshDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db);
  return db;
}

/** Link a Client to a fresh justdoit server over an in-memory transport pair. */
export async function makeClient(db: Db) {
  const server = createMcpServer(db);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

/**
 * Parse the first text content block of a tool result as JSON.
 *
 * NOTE: `client.callTool()`'s return type is a union with a legacy
 * `{ toolResult: unknown }` compatibility shape (for pre-`content` servers).
 * TS's weak-type check rejects that union against a `{ content?: [...] }`
 * parameter type outright ("no properties in common"), so this takes
 * `unknown` and narrows at runtime instead — every tool in this package
 * returns the modern `content` shape.
 */
export function firstJson(result: unknown): unknown {
  const content = (result as { content?: { type: string; text?: string }[] } | undefined)?.content;
  const block = content?.find((c) => c.type === 'text');
  return block?.text ? JSON.parse(block.text) : undefined;
}
