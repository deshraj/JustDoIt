'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { EstimateVsActual } from '@/lib/api';
import { useChartTheme, usePrefersReducedMotion } from './chart-theme';

export function EstimateVsActualChart({
  rows,
  isLoading,
}: {
  rows: EstimateVsActual[];
  isLoading: boolean;
}) {
  const theme = useChartTheme();
  const reducedMotion = usePrefersReducedMotion();
  const data = rows
    .filter((r) => r.estimateMinutes != null)
    .slice(0, 8)
    .map((r) => ({
      label: r.title.length > 18 ? `${r.title.slice(0, 17)}…` : r.title,
      fullTitle: r.title,
      estimate: r.estimateMinutes ?? 0,
      actual: r.actualMinutes,
    }));

  return (
    <section
      className="flex flex-col gap-2 rounded-lg bg-muted/30 p-4"
      aria-label="Estimate vs actual time per task"
    >
      <h3 className="text-sm font-medium text-foreground">Estimate vs actual</h3>
      {isLoading ? (
        <div className="h-56 animate-pulse rounded-md bg-muted" />
      ) : data.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No estimated tasks with tracked time in this range.
        </p>
      ) : (
        <>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
                  tickFormatter={(v: number) => `${v}m`}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: 'none',
                    borderRadius: 8,
                    color: theme.ink.primary,
                    fontSize: 12,
                  }}
                  labelFormatter={(_l, payload) => payload?.[0]?.payload.fullTitle ?? ''}
                  formatter={(value: number) => `${value}m`}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: theme.ink.secondary }} />
                <Bar
                  dataKey="estimate"
                  name="Estimate"
                  fill={theme.categorical[0]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={20}
                  isAnimationActive={!reducedMotion}
                />
                <Bar
                  dataKey="actual"
                  name="Actual"
                  fill={theme.categorical[1]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={20}
                  isAnimationActive={!reducedMotion}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="sr-only">
            <caption>Estimate vs actual time per task, in minutes</caption>
            <thead>
              <tr>
                <th>Task</th>
                <th>Estimate (min)</th>
                <th>Actual (min)</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.fullTitle}>
                  <td>{r.fullTitle}</td>
                  <td>{r.estimate}</td>
                  <td>{r.actual}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
