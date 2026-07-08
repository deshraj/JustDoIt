'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CreateSavedFilterInput } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export function useSavedFilters() {
  return useQuery({
    queryKey: qk.savedFilters.all,
    queryFn: () => api.listSavedFilters(),
  });
}

export function useCreateSavedFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSavedFilterInput) => api.createSavedFilter(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.savedFilters.all }),
  });
}

export function useDeleteSavedFilter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSavedFilter(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.savedFilters.all }),
  });
}
