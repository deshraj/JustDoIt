'use client';

import { useState } from 'react';
import { useApiKeys } from '@/hooks/use-api-keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CopyButton } from '@/components/copy-button';
import { claudeMcpAddCommand, mcpServerUrl } from '@/lib/mcp';

export function ApiKeysSettings(): React.ReactNode {
  const { list, create, revoke } = useApiKeys();
  const [name, setName] = useState('');
  const [freshRaw, setFreshRaw] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim()) return;
    const { raw } = await create.mutateAsync(name.trim());
    setFreshRaw(raw);
    setName('');
  }

  return (
    <section className="space-y-6">
      <form onSubmit={onCreate} className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Key name
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="laptop" />
        </label>
        <Button type="submit" disabled={create.isPending}>
          Create key
        </Button>
      </form>

      {freshRaw && (
        <div
          role="status"
          className="space-y-3 rounded-md border border-border bg-muted p-3 text-sm"
        >
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="font-medium">Copy this now — it won’t be shown again:</p>
              <CopyButton value={freshRaw} label="Copy key" />
            </div>
            <code className="block break-all rounded bg-background px-2 py-1.5">{freshRaw}</code>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Connect Claude Code
              </p>
              <CopyButton
                value={claudeMcpAddCommand(mcpServerUrl(), freshRaw)}
                label="Copy command"
              />
            </div>
            <pre className="overflow-x-auto rounded bg-background px-2 py-1.5 text-xs leading-relaxed">
              <code>{claudeMcpAddCommand(mcpServerUrl(), freshRaw)}</code>
            </pre>
          </div>
        </div>
      )}

      <ul className="divide-y divide-border">
        {(list.data ?? []).map((k) => (
          <li key={k.id} className="flex items-center justify-between py-2">
            <span>{k.name}</span>
            <Button variant="ghost" size="sm" onClick={() => void revoke.mutate(k.id)}>
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
