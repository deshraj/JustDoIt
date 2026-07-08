'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type CreateProjectInput } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export function useProjects(opts: { archived?: boolean } = {}) {
  return useQuery({
    queryKey: qk.projects.list(opts),
    queryFn: () => api.listProjects(opts),
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => api.createProject(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects.all }),
  });
}
