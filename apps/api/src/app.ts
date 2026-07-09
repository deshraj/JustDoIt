import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { startActivityLog, userService, type Db } from '@justdoit/core';
import { errorHandler } from './middleware/error';
import { apiKeyAuth } from './middleware/auth';
import { setUserContext, type AppEnv } from './context';
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
  /**
   * When set, every request must carry a matching `X-API-Key` header.
   * Defaults to `JUSTDOIT_API_KEY`. Unset ⇒ open (localhost dev UX).
   */
  apiKey?: string;
  /**
   * Allowed CORS origin(s). Defaults to `JUSTDOIT_CORS_ORIGIN` (comma-list)
   * or the local web + API dev origins. Never `*` (a matching key would be
   * meaningless if any origin could read responses).
   */
  corsOrigin?: string | string[];
}

const DEFAULT_CORS_ORIGINS = ['http://localhost:3000', 'http://localhost:8787'];

function resolveCorsOrigin(opts: CreateAppOptions): string | string[] {
  if (opts.corsOrigin !== undefined) return opts.corsOrigin;
  const env = process.env.JUSTDOIT_CORS_ORIGIN;
  if (env) return env.split(',').map((s) => s.trim());
  return DEFAULT_CORS_ORIGINS;
}

export function createApp(db: Db, opts: CreateAppOptions = {}): Hono<AppEnv> {
  // Idempotently ensure the fixed local user exists before any request
  // arrives — a fresh migrated DB already has it (0001 seed), but this
  // guards any edge case (e.g. a DB migrated by an older snapshot).
  userService.ensureLocalUser(db);
  // Attach the activity-log subscriber once per app instance so every
  // mutation made through this app's db is persisted to the audit trail.
  startActivityLog(db);

  const app = new Hono<AppEnv>();
  app.onError(errorHandler);
  // apps/web is a browser client on a different origin/port (Next dev on
  // :3000 vs this API on :8787) — without CORS every request fails at the
  // browser's preflight, even though curl/Playwright-server-to-server calls
  // work fine. Scoped to the local dev origins (never `*`) so a configured
  // API key stays meaningful. Registered before `apiKeyAuth` so CORS
  // preflight (OPTIONS) is answered without needing the key header.
  app.use(
    '*',
    cors({
      origin: resolveCorsOrigin(opts),
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'X-API-Key'],
    }),
  );
  app.use('*', apiKeyAuth(opts.apiKey ?? process.env.JUSTDOIT_API_KEY));
  app.use('*', setUserContext(db));
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
