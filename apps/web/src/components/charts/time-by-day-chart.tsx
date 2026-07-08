'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TimeReportBucket } from '@/lib/api';
import { formatDuration } from '@/lib/utils';
import { useChartTheme, usePrefersReducedMotion } from './chart-theme';

export function TimeByDayChart({
  buckets,
  isLoading,
}: {
  buckets: TimeReportBucket[];
  isLoading: boolean;
}) {
  const theme = useChartTheme();
  const reducedMotion = usePrefersReducedMotion();
  const data = buckets.map((b) => ({
    label: b.label.slice(5),
    fullLabel: b.label,
    seconds: b.totalSeconds,
  }));

  return (
    <section
      className="flex flex-col gap-2 rounded-lg bg-muted/30 p-4"
      aria-label="Time tracked per day"
    >
      <h3 className="text-sm font-medium text-foreground">Time tracked per day</h3>
      {isLoading ? (
        <div className="h-56 animate-pulse rounded-md bg-muted" />
      ) : data.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No tracked time in this range.
        </p>
      ) : (
        <>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={theme.ink.gridline} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: theme.ink.muted, fontSize: 11 }}
                  axisLine={{ stroke: theme.ink.baseline }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: theme.ink.muted, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => formatDuration(v)}
                  width={52}
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: 'none',
                    borderRadius: 8,
                    color: theme.ink.primary,
                    fontSize: 12,
                  }}
                  labelFormatter={(_l, payload) => payload?.[0]?.payload.fullLabel ?? ''}
                  formatter={(value: number) => [formatDuration(value), 'Tracked']}
                />
                <Area
                  type="monotone"
                  dataKey="seconds"
                  stroke={theme.categorical[0]}
                  fill={theme.categorical[0]}
                  fillOpacity={0.18}
                  strokeWidth={2}
                  isAnimationActive={!reducedMotion}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <table className="sr-only">
            <caption>Time tracked per day</caption>
            <thead>
              <tr>
                <th>Day</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.key}>
                  <td>{b.label}</td>
                  <td>{formatDuration(b.totalSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
