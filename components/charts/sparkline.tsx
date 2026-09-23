"use client";

import * as React from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { chartTheme } from "@/components/ui/design-system/theme";

/**
 * Sparkline (PR010.1) — axis-less micro trend for the `StatCard` slot.
 *
 * Purely decorative: it carries no labels, so it is `aria-hidden` and the
 * surrounding StatCard always states the value and delta in text.
 */
export function Sparkline({
  data,
  color = chartTheme.series[0],
  height = 40,
}: {
  data: readonly number[];
  color?: string;
  height?: number;
}) {
  const chartData = React.useMemo(() => data.map((value, index) => ({ index, value })), [data]);
  const gradientId = React.useId().replace(/:/g, "");

  if (chartData.length === 0) return null;

  return (
    <div aria-hidden style={{ height }}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default Sparkline;
