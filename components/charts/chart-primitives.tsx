"use client";

import * as React from "react";
import { chartTheme } from "@/components/ui/design-system/theme";

/**
 * Shared Recharts building blocks (PR010.1).
 *
 * Every chart in the product imports its tooltip, axis props and formatters
 * from here so the data-viz family is visually consistent and so the
 * formatting of money / percentages / compact numbers is defined exactly once.
 */

export interface TooltipPayloadEntry {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

export interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: TooltipPayloadEntry[];
  /** Formats each series value (e.g. currency, percent). */
  valueFormatter?: (value: number) => string;
  /** Overrides the tooltip's heading. */
  labelFormatter?: (label: string | number) => string;
}

/** Glass tooltip shared by every chart. */
export function ChartTooltip({
  active,
  label,
  payload,
  valueFormatter,
  labelFormatter,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="glass-panel min-w-[9rem] rounded-xl px-3 py-2.5">
      {label != null && (
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/45">
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      )}
      <ul className="space-y-1">
        {payload.map((entry, index) => {
          const numeric = typeof entry.value === "number" ? entry.value : Number(entry.value ?? 0);
          return (
            <li
              key={`${String(entry.dataKey ?? entry.name ?? index)}`}
              className="flex items-center justify-between gap-4 text-xs"
            >
              <span className="flex items-center gap-2 text-white/60">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: entry.color ?? chartTheme.series[0] }}
                />
                {entry.name}
              </span>
              <span className="font-semibold tabular-nums text-white">
                {valueFormatter ? valueFormatter(numeric) : numeric.toLocaleString("pt-BR")}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Axis props shared by cartesian charts. */
export const axisProps = {
  stroke: chartTheme.axis,
  tickLine: false,
  axisLine: false,
  tick: { fill: chartTheme.axis, fontSize: chartTheme.axisFontSize },
} as const;

/* ------------------------------------------------------------------ */
/* Formatters (pt-BR)                                                  */
/* ------------------------------------------------------------------ */

/** Integer cents → `R$ 1.234,56`. */
export function formatCentsBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

/** Integer cents → compact `R$ 12,3 mil` for dense axes. */
export function formatCentsCompact(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(cents / 100);
}

/** Plain count → `12,5 mil`. */
export function formatCompact(value: number): string {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

/** Basis points → `12,4%`. */
export function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}
