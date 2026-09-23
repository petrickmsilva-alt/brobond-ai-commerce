import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ChartCard (PR010.1) — framed container for a data visualisation.
 *
 * Owns everything around the plot: heading, description, trailing controls,
 * an optional legend row and a fixed-height body (so the layout never shifts
 * while the lazily-loaded chart bundle arrives).
 *
 * Accessibility: charts are decorative canvases to a screen reader, so the
 * card exposes `summary` — a plain-language sentence describing the trend —
 * in a visually-hidden paragraph associated with the plot region.
 */

export interface ChartLegendEntry {
  label: string;
  color: string;
}

export interface ChartCardProps extends React.HTMLAttributes<HTMLElement> {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  legend?: readonly ChartLegendEntry[];
  /** Plot area height in px. Defaults to 260. */
  height?: number;
  /** Screen-reader description of what the chart shows. */
  summary?: string;
}

export function ChartCard({
  title,
  description,
  icon: Icon,
  actions,
  legend,
  height = 260,
  summary,
  className,
  children,
  ...props
}: ChartCardProps) {
  const headingId = React.useId();
  const summaryId = React.useId();

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "glass-edge relative overflow-hidden rounded-2xl border border-white/8",
        "bg-surface-850 bg-gradient-to-b from-white/[0.045] to-transparent",
        "shadow-[0_8px_24px_-8px_rgba(0,0,0,0.45)]",
        className,
      )}
      {...props}
    >
      <header className="flex flex-col gap-3 px-6 pt-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <div
              aria-hidden
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/[0.04] text-brand-300"
            >
              <Icon className="h-4 w-4" />
            </div>
          )}
          <div className="min-w-0">
            <h2 id={headingId} className="truncate text-sm font-semibold tracking-tight text-white">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-xs leading-relaxed text-white/50">{description}</p>
            )}
          </div>
        </div>

        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>

      {legend && legend.length > 0 && (
        <ul className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 px-6">
          {legend.map((entry) => (
            <li key={entry.label} className="flex items-center gap-2 text-xs text-white/55">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              {entry.label}
            </li>
          ))}
        </ul>
      )}

      {summary && (
        <p id={summaryId} className="sr-only">
          {summary}
        </p>
      )}

      <div
        role="img"
        aria-describedby={summary ? summaryId : undefined}
        aria-label={summary ? undefined : title}
        className="px-2 pb-4 pt-5 sm:px-4"
        style={{ minHeight: height }}
      >
        {children}
      </div>
    </section>
  );
}
