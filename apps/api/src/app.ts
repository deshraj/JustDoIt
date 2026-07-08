import { Hono } from 'hono';
import type { Db } from '@justdoit/core';
import { errorHandler } from './middleware/error';
import { healthRoutes } from './routes/health';
import { projectRoutes } from './routes/projects';
import { tagRoutes } from './routes/tags';
import { taskRoutes } from './routes/tasks';
import { searchRoutes } from './routes/search';
import { quickAddRoutes } from './routes/quick-add';
import { transferRoutes } from './routes/transfer';
import { timeRoutes } from './routes/time-entries';
import { reportRoutes } from './routes/reports';
import { reminderRoutes } from './routes/reminders';

export function createApp(db: Db): Hono {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/', healthRoutes());
  app.route('/projects', projectRoutes(db));
  app.route('/tags', tagRoutes(db));
  app.route('/tasks', taskRoutes(db));
  app.route('/', searchRoutes(db));
  app.route('/', quickAddRoutes(db));
  app.route('/', transferRoutes(db));
  app.route('/', timeRoutes(db));
  app.route('/', reportRoutes(db));
  app.route('/reminders', reminderRoutes(db));
  return app;
}
