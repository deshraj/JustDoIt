import { ApiKeysSettings } from '@/components/api-keys-settings';

export default function SettingsPage(): React.ReactNode {
  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div>
        <h2 className="mb-4 text-lg font-medium">API keys</h2>
        <ApiKeysSettings />
      </div>
    </main>
  );
}
