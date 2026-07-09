import { ApiKeysSettings } from '@/components/api-keys-settings';
import { McpConnect } from '@/components/mcp-connect';

export default function SettingsPage(): React.ReactNode {
  return (
    <main className="mx-auto max-w-2xl space-y-10 p-8">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section>
        <h2 className="mb-1 text-lg font-medium">Connect an AI agent (MCP)</h2>
        <McpConnect />
      </section>

      <section>
        <h2 className="mb-1 text-lg font-medium">API keys</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Personal keys authenticate the MCP endpoint and REST API as you. Shown once on creation.
        </p>
        <ApiKeysSettings />
      </section>
    </main>
  );
}
