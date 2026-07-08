import { Hono } from 'hono';
import type { Db } from '@justdoit/core';
import { errorHandler } from './middleware/error';
import { healthRoutes } from './routes/health';
import { projectRoutes } from './routes/projects';
import { tagRoutes } from './routes/tags';

export function createApp(db: Db): Hono {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/', healthRoutes());
  app.route('/projects', projectRoutes(db));
  app.route('/tags', tagRoutes(db));
  // Mounted in later tasks:
  // app.route('/tasks', taskRoutes(db));
  // app.route('/', searchRoutes(db));
  // app.route('/', quickAddRoutes(db));
  // app.route('/', transferRoutes(db));
  return app;
}
