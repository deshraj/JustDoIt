'use client';

import { useState } from 'react';
import { useApiKeys } from '@/hooks/use-api-keys';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
        <div role="status" className="rounded-md border border-border bg-muted p-3 text-sm">
          <p className="mb-1 font-medium">Copy this now — it won’t be shown again:</p>
          <code className="break-all">{freshRaw}</code>
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
