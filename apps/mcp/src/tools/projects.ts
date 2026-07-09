import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { projectService, tagService, taskService, type Ctx } from '@justdoit/core';
import { guard } from '../helpers.js';

export function registerProjectTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    'create_project',
    {
      title: 'Create project',
      description: 'Create a project (list) to organize tasks.',
      inputSchema: {
        name: z.string().min(1),
        color: z.string().optional(),
        icon: z.string().optional(),
        description: z.string().optional(),
      },
    },
    (args) => guard(() => projectService.create(ctx, args)),
  );

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description: 'List projects. By default archived projects are hidden.',
      inputSchema: { includeArchived: z.boolean().optional() },
    },
    // `projectService.list`'s `archived` filter is a strict equality match (true =>
    // only archived, false => only active, undefined => both), so "include archived"
    // maps to "no filter" rather than "archived: true".
    ({ includeArchived }) =>
      guard(() => projectService.list(ctx, includeArchived ? {} : { archived: false })),
  );

  server.registerTool(
    'add_tag',
    {
      title: 'Add tag to task',
      description: 'Ensure a tag exists and attach it to a task.',
      inputSchema: {
        taskId: z.string(),
        name: z.string().min(1),
        color: z.string().optional(),
      },
    },
    ({ taskId, name, color }) =>
      guard(() => {
        // Validate the task exists BEFORE creating any tag, so a missing task can't
        // orphan a freshly-created tag row (tagService.get/attach would throw only
        // after the tag was already inserted). NotFound propagates as an isError.
        taskService.get(ctx, taskId);
        // NOTE (deviation): `tagService.create` (Phase 1) throws `ConflictError` on a
        // duplicate `name` rather than upserting — the plan's draft assumed an
        // idempotent create. So this looks the tag up by name via `tagService.list`
        // first and only creates it when absent, per the plan's own documented
        // fallback for that case.
        const existing = tagService.list(ctx).find((t) => t.name === name);
        const tag = existing ?? tagService.create(ctx, { name, color });
        tagService.attach(ctx, taskId, tag.id);
        return { taskId, tag };
      }),
  );
}
