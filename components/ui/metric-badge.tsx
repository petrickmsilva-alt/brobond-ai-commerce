import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * MetricBadge (PR010.1) — inline delta/variation pill.
 *
 * Used inside tables, chart headers and KPI tiles to express a change against
 * a baseline. Direction is derived from the numeric value (or forced via
 * `trend`) and is always conveyed by an arrow glyph in addition to colour.
 *
 * Accepts either a preformatted `label` or a raw `value` in basis points /
 * percent, which it formats with pt-BR conventions.
 */

export type MetricTrend = "up" | "down" | "neutral";

const trendStyles: Record<
  MetricTrend,
  { className: string; Icon: typeof ArrowUpRight; sr: string }
> = {
  up: {
    className: "border-emerald-400/25 bg-emerald-500/12 text-emerald-300",
    Icon: ArrowUpRight,
    sr: "aumento de",
  },
  down: {
    className: "border-red-400/25 bg-red-500/12 text-red-300",
    Icon: ArrowDownRight,
    sr: "queda de",
  },
  neutral: {
    className: "border-white/10 bg-white/[0.06] text-white/60",
    Icon: Minus,
    sr: "variação de",
  },
};

export interface MetricBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Percentage variation. Positive → up, negative → down, 0 → neutral. */
  value?: number;
  /** Override the auto-derived direction. */
  trend?: MetricTrend;
  /** Preformatted text. When omitted, `value` is rendered as a percentage. */
  label?: string;
  /** Hide the direction arrow (for neutral, non-directional metrics). */
  hideIcon?: boolean;
}

/** Format a percentage the pt-BR way: `12,4%` / `-3,0%`. */
function formatPercent(value: number): string {
  const formatted = Math.abs(value).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatted}%`;
}

export function MetricBadge({
  value,
  trend,
  label,
  hideIcon,
  className,
  ...props
}: MetricBadgeProps) {
  const direction: MetricTrend =
    trend ?? (value == null || value === 0 ? "neutral" : value > 0 ? "up" : "down");
  const style = trendStyles[direction];
  const text = label ?? (value != null ? formatPercent(value) : "—");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none tabular-nums",
        style.className,
        className,
      )}
      {...props}
    >
      {!hideIcon && <style.Icon aria-hidden className="h-3 w-3 shrink-0" />}
      <span className="sr-only">{style.sr}</span>
      {text}
    </span>
  );
}
