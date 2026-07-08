import { serve } from '@hono/node-server';
import { createDb, runMigrations } from '@justdoit/core';
import { createApp } from './app';

const dbUrl = process.env.JUSTDOIT_DB ?? 'justdoit.db';
const { db } = createDb(dbUrl);
runMigrations(db);

const app = createApp(db);
const port = Number(process.env.JUSTDOIT_API_PORT ?? 8787);

serve({ fetch: app.fetch, port });
console.log(`justdoit API listening on http://localhost:${port} (db: ${dbUrl})`);
