import { Hono } from 'hono';
import type { Db } from '@justdoit/core';
import { errorHandler } from './middleware/error';
import { healthRoutes } from './routes/health';
import { projectRoutes } from './routes/projects';
import { tagRoutes } from './routes/tags';
import { taskRoutes } from './routes/tasks';
import { searchRoutes } from './routes/search';

export function createApp(db: Db): Hono {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/', healthRoutes());
  app.route('/projects', projectRoutes(db));
  app.route('/tags', tagRoutes(db));
  app.route('/tasks', taskRoutes(db));
  app.route('/', searchRoutes(db));
  // Mounted in later tasks:
  // app.route('/', quickAddRoutes(db));
  // app.route('/', transferRoutes(db));
  return app;
}
