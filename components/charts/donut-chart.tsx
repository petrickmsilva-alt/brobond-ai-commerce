"use client";

import * as React from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { chartTheme } from "@/components/ui/design-system/theme";
import { ChartTooltip } from "./chart-primitives";

/**
 * DonutChart (PR010.1) — part-to-whole breakdown with a centre metric.
 *
 * The centre slot carries the headline number so the chart is legible at a
 * glance; the accompanying legend (rendered by `ChartCard`) provides the
 * non-colour label for each slice.
 */

export interface DonutDatum {
  label: string;
  value: number;
  color?: string;
}

export interface DonutChartProps {
  data: readonly DonutDatum[];
  height?: number;
  valueFormatter?: (value: number) => string;
  /** Big number rendered in the hole. */
  centerValue?: string;
  /** Caption under the centre value. */
  centerLabel?: string;
}

export function DonutChart({
  data,
  height = 260,
  valueFormatter,
  centerValue,
  centerLabel,
}: DonutChartProps) {
  const chartData = React.useMemo(
    () => data.map((entry) => ({ name: entry.label, value: entry.value, color: entry.color })),
    [data],
  );

  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Tooltip content={<ChartTooltip valueFormatter={valueFormatter} />} />
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            innerRadius="62%"
            outerRadius="88%"
            paddingAngle={2}
            stroke="none"
            isAnimationActive={false}
          >
            {chartData.map((entry, index) => (
              <Cell
                key={entry.name}
                fill={entry.color ?? chartTheme.series[index % chartTheme.series.length]}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      {(centerValue || centerLabel) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerValue && (
            <span className="text-xl font-semibold tracking-tight text-white">{centerValue}</span>
          )}
          {centerLabel && (
            <span className="mt-0.5 text-[11px] uppercase tracking-wider text-white/45">
              {centerLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default DonutChart;
