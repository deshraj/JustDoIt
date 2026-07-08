'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useChartTheme, usePrefersReducedMotion } from './chart-theme';

export interface ThroughputPoint {
  /** yyyy-MM-dd */
  key: string;
  label: string;
  count: number;
}

export function ThroughputChart({
  points,
  isLoading,
}: {
  points: ThroughputPoint[];
  isLoading: boolean;
}) {
  const theme = useChartTheme();
  const reducedMotion = usePrefersReducedMotion();
  const data = points.map((p) => ({ ...p, shortLabel: p.label.slice(5) }));
  const total = points.reduce((sum, p) => sum + p.count, 0);

  return (
    <section
      className="flex flex-col gap-2 rounded-lg bg-muted/30 p-4"
      aria-label="Throughput: tasks completed per day"
    >
      <h3 className="text-sm font-medium text-foreground">Throughput (completed per day)</h3>
      {isLoading ? (
        <div className="h-56 animate-pulse rounded-md bg-muted" />
      ) : total === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No tasks completed in this range.
        </p>
      ) : (
        <>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={theme.ink.gridline} vertical={false} />
                <XAxis
                  dataKey="shortLabel"
                  tick={{ fill: theme.ink.muted, fontSize: 11 }}
                  axisLine={{ stroke: theme.ink.baseline }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: theme.ink.muted, fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={28}
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: 'none',
                    borderRadius: 8,
                    color: theme.ink.primary,
                    fontSize: 12,
                  }}
                  labelFormatter={(_l, payload) => payload?.[0]?.payload.label ?? ''}
                  formatter={(value: number) => [value, 'Completed']}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke={theme.categorical[1]}
                  strokeWidth={2}
                  dot={{ r: 3, fill: theme.categorical[1] }}
                  isAnimationActive={!reducedMotion}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <table className="sr-only">
            <caption>Tasks completed per day</caption>
            <thead>
              <tr>
                <th>Day</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.key}>
                  <td>{p.label}</td>
                  <td>{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
