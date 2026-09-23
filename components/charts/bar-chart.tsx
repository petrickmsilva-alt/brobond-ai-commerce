"use client";

import * as React from "react";
import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "@/components/ui/design-system/theme";
import { ChartTooltip, axisProps } from "./chart-primitives";

/**
 * HorizontalBarChart (PR010.1) — ranked comparison (top products, top
 * creators, revenue by campaign).
 *
 * Horizontal orientation keeps long pt-BR labels readable without rotation.
 * Bars fade from the brand hue through the categorical ramp so adjacent rows
 * remain distinguishable.
 */

export interface BarDatum extends Record<string, string | number> {
  label: string;
  value: number;
}

export interface BarChartProps {
  data: readonly BarDatum[];
  height?: number;
  valueFormatter?: (value: number) => string;
  axisFormatter?: (value: number) => string;
  /** Series name shown in the tooltip. */
  name?: string;
  /** Width reserved for the category labels. */
  labelWidth?: number;
}

export function HorizontalBarChart({
  data,
  height = 260,
  valueFormatter,
  axisFormatter,
  name = "Valor",
  labelWidth = 140,
}: BarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBarChart
        data={data as BarDatum[]}
        layout="vertical"
        margin={{ ...chartTheme.margin, left: 0, right: 16 }}
        barCategoryGap={10}
      >
        <CartesianGrid stroke={chartTheme.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" {...axisProps} tickFormatter={axisFormatter} />
        <YAxis
          type="category"
          dataKey="label"
          {...axisProps}
          width={labelWidth}
          tick={{ fill: chartTheme.axis, fontSize: chartTheme.axisFontSize }}
        />
        <Tooltip
          cursor={{ fill: chartTheme.cursor }}
          content={<ChartTooltip valueFormatter={valueFormatter} />}
        />
        <Bar dataKey="value" name={name} radius={[0, 6, 6, 0]} isAnimationActive={false}>
          {data.map((entry, index) => (
            <Cell
              key={entry.label}
              fill={chartTheme.series[index % chartTheme.series.length]}
              fillOpacity={0.85}
            />
          ))}
        </Bar>
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}

export default HorizontalBarChart;
