'use client';

import { useQuery } from '@tanstack/react-query';
import { api, type TimeReportParams } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export function useTimeReport(params: TimeReportParams) {
  return useQuery({
    queryKey: qk.timeReport(params),
    queryFn: () => api.getTimeReport(params),
  });
}
