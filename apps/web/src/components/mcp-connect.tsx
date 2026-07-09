'use client';

import { claudeMcpAddCommand, mcpJsonConfig, mcpServerUrl } from '@/lib/mcp';
import { CopyButton } from '@/components/copy-button';

/**
 * Explains how to connect JustDoIt to an MCP client (Claude Code, etc.) using
 * a personal API key. The key placeholder is filled in by creating a key below.
 */
export function McpConnect(): React.ReactNode {
  const url = mcpServerUrl();
  const command = claudeMcpAddCommand(url);
  const json = mcpJsonConfig(url);

  return (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Connect JustDoIt to an AI agent via the{' '}
        <a
          href="https://modelcontextprotocol.io"
          target="_blank"
          rel="noreferrer"
          className="text-primary underline-offset-4 hover:underline"
        >
          Model Context Protocol
        </a>{' '}
        so it can read and manage your tasks. Create an API key below, then paste it into one of the
        snippets (replacing <code className="text-foreground">&lt;YOUR_API_KEY&gt;</code>).
      </p>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            MCP server URL
          </span>
          <CopyButton value={url} />
        </div>
        <code className="block break-all rounded-md bg-muted px-3 py-2 text-sm">{url}</code>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Claude Code
          </span>
          <CopyButton value={command} label="Copy command" />
        </div>
        <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs leading-relaxed">
          <code>{command}</code>
        </pre>
      </div>

      <details className="group">
        <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
          Other MCP clients (JSON config)
        </summary>
        <div className="mt-2 space-y-1.5">
          <div className="flex justify-end">
            <CopyButton value={json} label="Copy JSON" />
          </div>
          <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs leading-relaxed">
            <code>{json}</code>
          </pre>
        </div>
      </details>
    </section>
  );
}
