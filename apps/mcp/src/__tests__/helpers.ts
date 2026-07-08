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

/** Parse the first text content block of a tool result as JSON. */
export function firstJson(result: { content: { type: string; text?: string }[] }): unknown {
  const block = result.content.find((c) => c.type === 'text');
  return block?.text ? JSON.parse(block.text) : undefined;
}
