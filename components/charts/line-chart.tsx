"use client";

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/ui/design-system/theme";
import { ChartTooltip, axisProps } from "./chart-primitives";

/**
 * LineChart (PR010.1) — multi-series comparison over time.
 *
 * Series are distinguished by colour *and* by legend label (rendered by the
 * enclosing `ChartCard`), never by colour alone.
 */

export interface LineSeries {
  dataKey: string;
  name: string;
  color?: string;
  /** Dashed stroke — useful for a target/baseline series. */
  dashed?: boolean;
}

export interface LineChartProps {
  data: ReadonlyArray<Record<string, string | number>>;
  xKey: string;
  series: readonly LineSeries[];
  height?: number;
  valueFormatter?: (value: number) => string;
  axisFormatter?: (value: number) => string;
}

export function LineChart({
  data,
  xKey,
  series,
  height = 260,
  valueFormatter,
  axisFormatter,
}: LineChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsLineChart
        data={data as Record<string, string | number>[]}
        margin={chartTheme.margin}
      >
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
            <Line
              key={entry.dataKey}
              type="monotone"
              dataKey={entry.dataKey}
              name={entry.name}
              stroke={color}
              strokeWidth={2}
              strokeDasharray={entry.dashed ? "5 4" : undefined}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: chartTheme.tooltip.background }}
              isAnimationActive={false}
            />
          );
        })}
      </RechartsLineChart>
    </ResponsiveContainer>
  );
}

export default LineChart;
