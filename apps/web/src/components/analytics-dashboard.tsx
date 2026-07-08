'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays, differenceInCalendarDays, endOfDay, format, startOfDay, subDays } from 'date-fns';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useTimeReport } from '@/hooks/use-time-report';
import { Button } from '@/components/ui/button';
import { TimeByDayChart } from '@/components/charts/time-by-day-chart';
import { TimeByProjectChart } from '@/components/charts/time-by-project-chart';
import { TimeByTagChart } from '@/components/charts/time-by-tag-chart';
import { EstimateVsActualChart } from '@/components/charts/estimate-vs-actual-chart';
import { ThroughputChart, type ThroughputPoint } from '@/components/charts/throughput-chart';
import { formatDuration } from '@/lib/utils';

const PRESETS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
] as const;

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted/30 p-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-2xl text-foreground">{value}</span>
    </div>
  );
}

export function AnalyticsDashboard() {
  const [days, setDays] = useState<number>(30);

  const { from, to } = useMemo(() => {
    const rangeTo = endOfDay(new Date());
    const rangeFrom = startOfDay(subDays(rangeTo, days - 1));
    return { from: rangeFrom, to: rangeTo };
  }, [days]);

  const dayReport = useTimeReport({ groupBy: 'day', from, to });
  const projectReport = useTimeReport({ groupBy: 'project', from, to });
  const tagReport = useTimeReport({ groupBy: 'tag', from, to });

  // The API has no completed-date range filter, so we fetch all done tasks
  // and bucket/filter by completedAt client-side — fine at personal-app scale.
  const { data: doneTasks, isLoading: doneLoading } = useQuery({
    queryKey: qk.tasks.list({ status: 'done' }),
    queryFn: () => api.listTasks({ status: 'done' }),
  });

  const completedInRange = useMemo(
    () =>
      (doneTasks ?? []).filter(
        (t) => t.completedAt && t.completedAt >= from && t.completedAt <= to,
      ),
    [doneTasks, from, to],
  );

  const rangeDays = differenceInCalendarDays(to, from) + 1;

  const throughputPoints: ThroughputPoint[] = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const t of completedInRange) {
      if (!t.completedAt) continue;
      const key = format(t.completedAt, 'yyyy-MM-dd');
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    return Array.from({ length: rangeDays }, (_, i) => {
      const key = format(addDays(from, i), 'yyyy-MM-dd');
      return { key, label: key, count: byDay.get(key) ?? 0 };
    });
  }, [completedInRange, from, rangeDays]);

  const totalSeconds = dayReport.data?.totalSeconds ?? 0;
  const avgPerDaySeconds = rangeDays > 0 ? totalSeconds / rangeDays : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg text-foreground">Analytics</h1>
        <div className="flex items-center gap-1" role="group" aria-label="Date range">
          {PRESETS.map((preset) => (
            <Button
              key={preset.days}
              size="sm"
              variant={days === preset.days ? 'secondary' : 'ghost'}
              onClick={() => setDays(preset.days)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile label="Total tracked" value={formatDuration(totalSeconds)} />
        <StatTile label="Tasks completed" value={String(completedInRange.length)} />
        <StatTile label="Avg tracked / day" value={formatDuration(avgPerDaySeconds)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TimeByDayChart buckets={dayReport.data?.buckets ?? []} isLoading={dayReport.isLoading} />
        <ThroughputChart points={throughputPoints} isLoading={doneLoading} />
        <TimeByProjectChart
          buckets={projectReport.data?.buckets ?? []}
          isLoading={projectReport.isLoading}
        />
        <TimeByTagChart buckets={tagReport.data?.buckets ?? []} isLoading={tagReport.isLoading} />
        <div className="lg:col-span-2">
          <EstimateVsActualChart
            rows={dayReport.data?.estimateVsActual ?? []}
            isLoading={dayReport.isLoading}
          />
        </div>
      </div>
    </div>
  );
}
