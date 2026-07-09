import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  taskService,
  projectService,
  listOverdue,
  listDueToday,
  LOCAL_USER_ID,
  type Db,
} from '@justdoit/core';

function jsonContents(uri: string, value: unknown) {
  return {
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value ?? null, null, 2) }],
  };
}

export function registerResources(server: McpServer, db: Db): void {
  server.registerResource(
    'task',
    new ResourceTemplate('task://{id}', { list: undefined }),
    { title: 'Task', description: 'A single task by id', mimeType: 'application/json' },
    async (uri, { id }) => jsonContents(uri.href, taskService.get(db, String(id))),
  );

  server.registerResource(
    'project',
    new ResourceTemplate('project://{id}', { list: undefined }),
    { title: 'Project', description: 'A single project by id', mimeType: 'application/json' },
    async (uri, { id }) =>
      jsonContents(uri.href, projectService.get({ db, userId: LOCAL_USER_ID }, String(id))),
  );

  server.registerResource(
    'tasks-today',
    'tasks://today',
    { title: "Today's tasks", description: 'Active tasks due today', mimeType: 'application/json' },
    async (uri) => jsonContents(uri.href, listDueToday(db, new Date())),
  );

  server.registerResource(
    'tasks-overdue',
    'tasks://overdue',
    {
      title: 'Overdue tasks',
      description: 'Incomplete tasks past their due date',
      mimeType: 'application/json',
    },
    async (uri) => jsonContents(uri.href, listOverdue(db, new Date())),
  );
}
