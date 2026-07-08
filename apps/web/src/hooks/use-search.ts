'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export function useSearch(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: qk.search(query),
    queryFn: () => api.search(query),
    enabled: query.length > 0,
  });
}
