import { serve } from '@hono/node-server';
import { createDb, runMigrations } from '@justdoit/core';
import { createApp } from './app';
import { startReminderScheduler } from './scheduler';

const dbUrl = process.env.JUSTDOIT_DB ?? 'justdoit.db';
const { db } = createDb(dbUrl);
runMigrations(db);

const filesDir = process.env.JUSTDOIT_FILES_DIR ?? './data/files';
const app = createApp(db, { filesDir });
const port = Number(process.env.JUSTDOIT_API_PORT ?? 8787);
// Bind to loopback by default so a local-first tool isn't exposed on the LAN.
const host = process.env.JUSTDOIT_API_HOST ?? '127.0.0.1';

serve({ fetch: app.fetch, port, hostname: host });
console.log(`justdoit API listening on http://${host}:${port} (db: ${dbUrl}, files: ${filesDir})`);

if (process.env.JUSTDOIT_DISABLE_SCHEDULER !== '1') {
  startReminderScheduler({ db });
}
