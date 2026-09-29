"use client";

import * as React from "react";
import {
  Area,
  AreaChart as RechartsAreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/ui/design-system/theme";
import { ChartTooltip, axisProps } from "./chart-primitives";

/**
 * AreaChart (PR010.1) — gradient-filled trend over time.
 *
 * Client Component, loaded lazily by `components/charts/lazy` so the Recharts
 * bundle never blocks the first paint of a dashboard.
 */

export interface AreaSeries {
  dataKey: string;
  name: string;
  color?: string;
}

export interface AreaChartProps {
  data: ReadonlyArray<Record<string, string | number>>;
  /** Key holding the category/time label. */
  xKey: string;
  series: readonly AreaSeries[];
  height?: number;
  valueFormatter?: (value: number) => string;
  /** Compact formatter for the Y axis ticks. */
  axisFormatter?: (value: number) => string;
}

export function AreaChart({
  data,
  xKey,
  series,
  height = 260,
  valueFormatter,
  axisFormatter,
}: AreaChartProps) {
  const gradientId = React.useId().replace(/:/g, "");

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsAreaChart
        data={data as Record<string, string | number>[]}
        margin={chartTheme.margin}
      >
        <defs>
          {series.map((entry, index) => {
            const color = entry.color ?? chartTheme.series[index % chartTheme.series.length];
            return (
              <linearGradient
                key={entry.dataKey}
                id={`${gradientId}-${entry.dataKey}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={color} stopOpacity={0.36} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            );
          })}
        </defs>

        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} {...axisProps} dy={8} />
        <YAxis {...axisProps} width={56} tickFormatter={axisFormatter} />
        <Tooltip
          cursor={{ stroke: chartTheme.cursor, strokeWidth: 1 }}
          content={<ChartTooltip valueFormatter={valueFormatter} />}
        />

        {series.map((entry, index) => {
          const color = entry.color ?? chartTheme.series[index % chartTheme.series.length];
          return (
            <Area
              key={entry.dataKey}
              type="monotone"
              dataKey={entry.dataKey}
              name={entry.name}
              stroke={color}
              strokeWidth={2}
              fill={`url(#${gradientId}-${entry.dataKey})`}
              activeDot={{ r: 4, strokeWidth: 2, stroke: chartTheme.tooltip.background }}
              isAnimationActive={false}
            />
          );
        })}
      </RechartsAreaChart>
    </ResponsiveContainer>
  );
}

export default AreaChart;
