'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export function useProjects(opts: { archived?: boolean } = {}) {
  return useQuery({
    queryKey: qk.projects.list(opts),
    queryFn: () => api.listProjects(opts),
  });
}
