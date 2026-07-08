'use client';

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { TimeReportBucket } from '@/lib/api';
import { formatDuration } from '@/lib/utils';
import { useChartTheme, usePrefersReducedMotion } from './chart-theme';

/** Ranked magnitude comparison (not identity) -> a single hue, not one color per bar. */
export function TimeByProjectChart({
  buckets,
  isLoading,
}: {
  buckets: TimeReportBucket[];
  isLoading: boolean;
}) {
  const theme = useChartTheme();
  const reducedMotion = usePrefersReducedMotion();
  const data = [...buckets]
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, 8)
    .map((b) => ({ label: b.label, seconds: b.totalSeconds }));

  return (
    <section
      className="flex flex-col gap-2 rounded-lg bg-muted/30 p-4"
      aria-label="Time per project"
    >
      <h3 className="text-sm font-medium text-foreground">Time per project</h3>
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
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
              >
                <CartesianGrid stroke={theme.ink.gridline} horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: theme.ink.muted, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => formatDuration(v)}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={{ fill: theme.ink.secondary, fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                  width={96}
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: 'none',
                    borderRadius: 8,
                    color: theme.ink.primary,
                    fontSize: 12,
                  }}
                  formatter={(value: number) => [formatDuration(value), 'Tracked']}
                />
                <Bar
                  dataKey="seconds"
                  fill={theme.categorical[0]}
                  radius={[0, 4, 4, 0]}
                  maxBarSize={18}
                  isAnimationActive={!reducedMotion}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="sr-only">
            <caption>Time per project</caption>
            <thead>
              <tr>
                <th>Project</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {data.map((b) => (
                <tr key={b.label}>
                  <td>{b.label}</td>
                  <td>{formatDuration(b.seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
