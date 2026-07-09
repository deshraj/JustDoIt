type Env = Record<string, string | undefined>;

/**
 * Public URL of the MCP endpoint (served by the API's `/mcp` route). Set
 * NEXT_PUBLIC_MCP_URL in hosted mode (the API's public domain + /mcp); falls
 * back to the local API for dev.
 */
export function mcpServerUrl(env: Env = process.env): string {
  return (env.NEXT_PUBLIC_MCP_URL ?? 'http://localhost:8787/mcp').replace(/\/$/, '');
}

/** Ready-to-run `claude mcp add` command for Claude Code. */
export function claudeMcpAddCommand(url: string, apiKey = '<YOUR_API_KEY>'): string {
  return `claude mcp add --transport http justdoit ${url} --header "X-API-Key: ${apiKey}"`;
}

/** Generic mcpServers config block for other MCP clients. */
export function mcpJsonConfig(url: string, apiKey = '<YOUR_API_KEY>'): string {
  return JSON.stringify(
    { mcpServers: { justdoit: { type: 'http', url, headers: { 'X-API-Key': apiKey } } } },
    null,
    2,
  );
}
