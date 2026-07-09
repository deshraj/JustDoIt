'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ApiKey } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export function useApiKeys() {
  const qc = useQueryClient();
  const list = useQuery<ApiKey[]>({ queryKey: qk.apiKeys, queryFn: api.listApiKeys });
  const create = useMutation({
    mutationFn: (name: string) => api.createApiKey(name),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.apiKeys }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.apiKeys }),
  });
  return { list, create, revoke };
}
