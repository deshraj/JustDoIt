'use client';

import { useEffect, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRunningEntry, useStartTimer, useStopTimer } from '@/hooks/use-timer';

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function InlineTimer({ taskId }: { taskId: string }) {
  const { data: running } = useRunningEntry(taskId);
  const start = useStartTimer(taskId);
  const stop = useStopTimer(taskId);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const elapsedMs = running ? now - running.startedAt.getTime() : 0;

  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-sm tabular-nums text-muted-foreground" aria-live="polite">
        {running ? formatElapsed(elapsedMs) : '00:00'}
      </span>
      {running ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => stop.mutate()}
          disabled={stop.isPending}
        >
          <Square className="size-3.5" />
          Stop
        </Button>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => start.mutate()}
          disabled={start.isPending}
        >
          <Play className="size-3.5" />
          Start
        </Button>
      )}
    </div>
  );
}
