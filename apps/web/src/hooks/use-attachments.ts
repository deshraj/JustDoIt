'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export function useAttachments(taskId: string) {
  return useQuery({
    queryKey: qk.attachments.task(taskId),
    queryFn: () => api.listAttachments(taskId),
    enabled: Boolean(taskId),
  });
}

export function useUploadAttachment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadAttachment(taskId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.attachments.task(taskId) }),
  });
}

export function useDeleteAttachment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteAttachment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.attachments.task(taskId) }),
  });
}
