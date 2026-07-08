'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type Tag } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export function useTags() {
  return useQuery({ queryKey: qk.tags.all, queryFn: () => api.listTags() });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.createTag({ name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tags.all }),
    onError: () => toast.error('Could not create that tag — try again.'),
  });
}

export function useTaskTags(taskId: string) {
  return useQuery({
    queryKey: qk.tasks.tags(taskId),
    queryFn: () => api.listTaskTags(taskId),
    enabled: Boolean(taskId),
  });
}

export function useAttachTag(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tagId: string) => api.attachTag(taskId, tagId),
    onSuccess: (tags: Tag[]) => qc.setQueryData(qk.tasks.tags(taskId), tags),
    onError: () => toast.error('Could not add that tag — try again.'),
  });
}

export function useDetachTag(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tagId: string) => api.detachTag(taskId, tagId),
    onSuccess: (tags: Tag[]) => qc.setQueryData(qk.tasks.tags(taskId), tags),
    onError: () => toast.error('Could not remove that tag — try again.'),
  });
}
