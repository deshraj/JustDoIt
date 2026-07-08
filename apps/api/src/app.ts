import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { startActivityLog, type Db } from '@justdoit/core';
import { errorHandler } from './middleware/error';
import { healthRoutes } from './routes/health';
import { projectRoutes } from './routes/projects';
import { tagRoutes } from './routes/tags';
import { taskRoutes } from './routes/tasks';
import { taskTagRoutes } from './routes/task-tags';
import { searchRoutes } from './routes/search';
import { quickAddRoutes } from './routes/quick-add';
import { transferRoutes } from './routes/transfer';
import { timeRoutes } from './routes/time-entries';
import { reportRoutes } from './routes/reports';
import { reminderRoutes } from './routes/reminders';
import { activityRoutes } from './routes/activity';
import { eventsRoutes } from './routes/events';
import { savedFilterRoutes } from './routes/saved-filters';
import { attachmentRoutes } from './routes/attachments';

export interface CreateAppOptions {
  /** Attachment storage dir; defaults to JUSTDOIT_FILES_DIR or ./data/files. */
  filesDir?: string;
}

export function createApp(db: Db, opts: CreateAppOptions = {}): Hono {
  // Attach the activity-log subscriber once per app instance so every
  // mutation made through this app's db is persisted to the audit trail.
  startActivityLog(db);

  const app = new Hono();
  app.onError(errorHandler);
  // apps/web is a browser client on a different origin/port (Next dev on
  // :3000 vs this API on :8787) — without CORS every request fails at the
  // browser's preflight, even though curl/Playwright-server-to-server calls
  // work fine. Permissive by design: this is a local-first single-user tool.
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'X-API-Key'],
    }),
  );
  app.route('/', healthRoutes());
  app.route('/projects', projectRoutes(db));
  app.route('/tags', tagRoutes(db));
  app.route('/tasks', taskRoutes(db));
  app.route('/', taskTagRoutes(db));
  app.route('/', searchRoutes(db));
  app.route('/', quickAddRoutes(db));
  app.route('/', transferRoutes(db));
  app.route('/', timeRoutes(db));
  app.route('/', reportRoutes(db));
  app.route('/reminders', reminderRoutes(db));
  app.route('/', activityRoutes(db));
  app.route('/', eventsRoutes());
  app.route('/', savedFilterRoutes(db));
  const filesDir = opts.filesDir ?? process.env.JUSTDOIT_FILES_DIR ?? './data/files';
  app.route('/', attachmentRoutes(db, filesDir));
  return app;
}
