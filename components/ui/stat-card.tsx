import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * StatCard (PR010.1) — the canonical KPI tile.
 *
 * Anatomy: label · value · optional trend delta · optional icon medallion ·
 * optional sparkline slot. Trend direction is carried by BOTH an arrow glyph
 * and colour, never colour alone (WCAG 1.4.1).
 *
 * This is a Server Component by default — it is pure presentation and holds
 * no state, so KPI grids stay off the client bundle.
 */

export type Trend = "up" | "down" | "neutral";

const trendStyles: Record<Trend, { className: string; Icon: LucideIcon; srLabel: string }> = {
  up: { className: "text-emerald-300", Icon: ArrowUpRight, srLabel: "Em alta:" },
  down: { className: "text-red-300", Icon: ArrowDownRight, srLabel: "Em queda:" },
  neutral: { className: "text-white/50", Icon: Minus, srLabel: "Estável:" },
};

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  /** Short comparison text, e.g. "+12,4% vs. período anterior". */
  delta?: string;
  trend?: Trend;
  icon?: LucideIcon;
  /** Optional compact visual (sparkline, mini bar) rendered under the value. */
  sparkline?: React.ReactNode;
  /** Optional supporting line rendered below everything else. */
  hint?: string;
  badge?: React.ReactNode;
  className?: string;
}

export function StatCard({
  label,
  value,
  delta,
  trend = "neutral",
  icon: Icon,
  sparkline,
  hint,
  badge,
  className,
}: StatCardProps) {
  const { className: trendClass, Icon: TrendIcon, srLabel } = trendStyles[trend];

  return (
    <div
      className={cn(
        "glass-edge group relative overflow-hidden rounded-2xl border border-white/8",
        "bg-surface-850/90 bg-gradient-to-b from-white/[0.045] to-transparent p-5",
        "shadow-[0_8px_24px_-8px_rgba(0,0,0,0.45)]",
        "transition-[border-color,box-shadow,transform] duration-200 ease-out",
        "hover:-translate-y-0.5 hover:border-white/15 hover:shadow-[0_16px_48px_-12px_rgba(0,0,0,0.55)]",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-brand-500/10 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100"
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
              {label}
            </p>
            {badge && <div className="flex shrink-0 items-center">{badge}</div>}
          </div>

          <p className="mt-3 truncate text-[1.9rem] font-semibold tracking-[-0.04em] text-white">
            {value}
          </p>

          {delta && (
            <p
              className={cn(
                "mt-2 inline-flex items-center gap-1 rounded-full border border-white/8 bg-white/[0.02] px-2 py-1 text-[11px] font-medium",
                trendClass,
              )}
            >
              <TrendIcon aria-hidden className="h-3.5 w-3.5 shrink-0" />
              <span className="sr-only">{srLabel}</span>
              <span className="truncate">{delta}</span>
            </p>
          )}
        </div>

        {Icon && (
          <div
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-brand-500/12 text-brand-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
          >
            <Icon className="h-5 w-5" />
          </div>
        )}
      </div>

      {sparkline && <div className="relative mt-4 h-10">{sparkline}</div>}
      {hint && <p className="relative mt-3 text-[11px] leading-relaxed text-white/40">{hint}</p>}
    </div>
  );
}
