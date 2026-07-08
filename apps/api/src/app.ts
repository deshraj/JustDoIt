import { Hono } from 'hono';
import type { Db } from '@justdoit/core';
import { errorHandler } from './middleware/error';
import { healthRoutes } from './routes/health';

export function createApp(db: Db): Hono {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/', healthRoutes());
  // Mounted in later tasks:
  // app.route('/projects', projectRoutes(db));
  // app.route('/tags', tagRoutes(db));
  // app.route('/tasks', taskRoutes(db));
  // app.route('/', searchRoutes(db));
  // app.route('/', quickAddRoutes(db));
  // app.route('/', transferRoutes(db));
  void db;
  return app;
}
