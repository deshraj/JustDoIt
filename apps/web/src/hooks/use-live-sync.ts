'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiUrl } from '@/lib/api';
import { qk } from '@/lib/query-keys';

interface WireEvent {
  type: string;
  entityType: 'task' | 'project' | 'time_entry';
  entityId: string;
  action: string;
  at: number;
}

/**
 * Subscribes to the API's `GET /events` SSE stream and invalidates the
 * matching TanStack Query keys per entity type, so a mutation from another
 * tab, a raw REST call, or (within the same API process) the MCP server's
 * activity is reflected here without a manual refresh.
 */
export function useLiveSync(): void {
  const qc = useQueryClient();

  useEffect(() => {
    const source = new EventSource(apiUrl('/events'));

    const handle = (raw: MessageEvent<string>) => {
      let evt: WireEvent;
      try {
        evt = JSON.parse(raw.data) as WireEvent;
      } catch {
        return;
      }
      switch (evt.entityType) {
        case 'task':
          qc.invalidateQueries({ queryKey: qk.tasks.all });
          qc.invalidateQueries({ queryKey: qk.tasks.detail(evt.entityId) });
          qc.invalidateQueries({ queryKey: qk.activity.task(evt.entityId) });
          break;
        case 'project':
          qc.invalidateQueries({ queryKey: qk.projects.all });
          qc.invalidateQueries({ queryKey: qk.tasks.all });
          break;
        case 'time_entry':
          qc.invalidateQueries({ queryKey: qk.timeEntries.all });
          qc.invalidateQueries({ queryKey: ['reports'] });
          qc.invalidateQueries({ queryKey: qk.tasks.all });
          break;
      }
    };

    // The API tags change frames with `event: change`; also handle the
    // default `message` event so a plain `EventSource` without a listener
    // for a named event still works.
    source.addEventListener('change', handle as EventListener);
    source.onmessage = handle;

    // A native EventSource auto-reconnects after a transient network drop,
    // but any change events published while disconnected are lost — there's
    // no way to replay them individually, so do a broad invalidate as a
    // catch-up once the connection comes back (or looks like it's about to).
    source.onerror = () => {
      qc.invalidateQueries({ queryKey: qk.tasks.all });
      qc.invalidateQueries({ queryKey: qk.projects.all });
    };

    return () => source.close();
  }, [qc]);
}

/** Headless mount point — rendered once near the app root. */
export function LiveSync(): null {
  useLiveSync();
  return null;
}
